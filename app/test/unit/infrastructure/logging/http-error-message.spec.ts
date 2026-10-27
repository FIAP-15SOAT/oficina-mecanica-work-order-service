import { BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';

import { DomainValidationException } from '@domain/exceptions/domain-validation.exception';
import { resolveHttpErrorMessage } from '@infrastructure/logging/http-error-message';
import { REDACTED } from '@infrastructure/logging/redaction/text-sanitizer';

const JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';

interface FakeRequestOptions {
  method?: string;
  path?: string;
  query?: Record<string, unknown>;
  originalUrl?: string;
}

function createRequest(options: FakeRequestOptions = {}): Request {
  const path = options.path ?? '/api/missing';
  const rawQuery = Object.entries(options.query ?? {})
    .map(([key, value]) => `${key}=${String(value)}`)
    .join('&');

  return {
    method: options.method ?? 'GET',
    path,
    url: path,
    originalUrl: options.originalUrl ?? (rawQuery ? `${path}?${rawQuery}` : path),
    query: options.query ?? {},
  } as unknown as Request;
}

/** Reproduces Nest's construction: `Cannot ${method} ${originalUrl}`. */
function frameworkNotFound(request: Request): NotFoundException {
  return new NotFoundException(`Cannot ${request.method} ${request.originalUrl}`);
}

describe('resolveHttpErrorMessage — framework-generated 404', () => {
  /**
   * Nest builds the automatic 404 message with `request.originalUrl`, query
   * included, and it went whole into `oficina.error.message` — putting back into
   * the log the raw URL that `url.query` exists precisely not to record.
   */
  it('should rebuild the message without the raw query', () => {
    const request = createRequest({ query: { token: JWT, page: '2' } });

    const message = resolveHttpErrorMessage(frameworkNotFound(request), request, 404);

    expect(message).toBe('Cannot GET /api/missing?page=2');
    expect(message).not.toContain('eyJ');
  });

  it('should omit the query separator when nothing survives classification', () => {
    const request = createRequest({ query: { token: JWT } });

    expect(resolveHttpErrorMessage(frameworkNotFound(request), request, 404)).toBe(
      'Cannot GET /api/missing',
    );
  });

  it('should sanitize a personal identifier carried in the path', () => {
    const request = createRequest({ path: '/api/customers/123.456.789-09', method: 'POST' });

    expect(resolveHttpErrorMessage(frameworkNotFound(request), request, 404)).toBe(
      'Cannot POST /api/customers/***.***.789-09',
    );
  });

  it('should fall back to the url when the request exposes no path', () => {
    const request = {
      method: 'GET',
      url: '/api/raw',
      originalUrl: '/api/raw',
      query: {},
    } as unknown as Request;

    expect(resolveHttpErrorMessage(frameworkNotFound(request), request, 404)).toBe(
      'Cannot GET /api/raw',
    );
  });

  it('should tolerate a request that exposes neither path nor url', () => {
    const request = { method: 'GET', query: {} } as unknown as Request;

    expect(resolveHttpErrorMessage(new NotFoundException('Cannot GET '), request, 404)).toBe(
      'Cannot GET ',
    );
  });

  /**
   * The branch is recognized by exact equality against the framework template
   * applied to this request. A business message cannot match it, so a
   * `NotFoundException` from a real handler passes untouched — even when the path
   * is the same.
   */
  it('should preserve a 404 raised by a real handler', () => {
    const request = createRequest({ path: '/api/quotes/1' });
    const exception = new NotFoundException('Orçamento não encontrado(a)');

    expect(resolveHttpErrorMessage(exception, request, 404)).toBe('Orçamento não encontrado(a)');
  });

  it('should preserve a 404 whose message merely resembles the framework template', () => {
    const request = createRequest({ path: '/api/quotes/1' });
    const exception = new NotFoundException('Cannot GET /outra-coisa');

    expect(resolveHttpErrorMessage(exception, request, 404)).toBe('Cannot GET /outra-coisa');
  });

  it('should not rewrite a non-404', () => {
    expect(resolveHttpErrorMessage(new UnauthorizedException(), createRequest(), 401)).toBe(
      'Unauthorized',
    );
  });

  it('should not rewrite when there is no request at all', () => {
    expect(resolveHttpErrorMessage(new NotFoundException('sem request'), undefined, 404)).toBe(
      'sem request',
    );
  });
});

describe('resolveHttpErrorMessage — HTTP exception detail', () => {
  /**
   * Nest's `initMessage()` only copies `response.message` when it is a string.
   * For class-validator's `string[]`, `exception.message` becomes `"Bad Request
   * Exception"` and the real cause of the rejection — the API's most common 4xx
   * — never reached the log.
   */
  it('should join the validation messages the exception message hides', () => {
    const exception = new BadRequestException([
      'email must be an email',
      'name should not be empty',
    ]);

    expect(exception.message).toBe('Bad Request Exception');
    expect(resolveHttpErrorMessage(exception, createRequest(), 400)).toBe(
      'email must be an email; name should not be empty',
    );
  });

  it('should bound the number of validation messages', () => {
    const messages = Array.from({ length: 25 }, (_, index) => `campo${index} inválido`);

    const message = resolveHttpErrorMessage(
      new BadRequestException(messages),
      createRequest(),
      400,
    );

    expect(message).toContain('campo9 inválido');
    expect(message).not.toContain('campo10 inválido');
    expect(message).toContain('(+15)');
  });

  it('should sanitize sensitive content carried by a validation message', () => {
    const exception = new BadRequestException([`token ${JWT} inválido`]);

    expect(resolveHttpErrorMessage(exception, createRequest(), 400)).toBe(
      `token ${REDACTED} inválido`,
    );
  });

  it('should use a string response as the message', () => {
    expect(
      resolveHttpErrorMessage(new BadRequestException('corpo inválido'), createRequest(), 400),
    ).toBe('corpo inválido');
  });

  it('should use an object response carrying a string message', () => {
    const exception = new BadRequestException({ statusCode: 400, message: 'documento inválido' });

    expect(resolveHttpErrorMessage(exception, createRequest(), 400)).toBe('documento inválido');
  });

  it('should fall back to the exception message when the response carries no message', () => {
    const exception = new BadRequestException({ statusCode: 400, error: 'Bad Request' });

    expect(resolveHttpErrorMessage(exception, createRequest(), 400)).toBe('Bad Request Exception');
  });

  it('should fall back to the exception message when the message is neither string nor array', () => {
    const exception = new BadRequestException({ statusCode: 400, message: { nested: true } });

    expect(resolveHttpErrorMessage(exception, createRequest(), 400)).toBe('Bad Request Exception');
  });

  it('should use the plain message of an exception outside the HTTP hierarchy', () => {
    expect(
      resolveHttpErrorMessage(
        new DomainValidationException('Documento inválido'),
        createRequest(),
        422,
      ),
    ).toBe('Documento inválido');
  });

  it('should sanitize a thrown string', () => {
    expect(resolveHttpErrorMessage(`Bearer ${JWT} recusado`, createRequest(), 500)).toBe(
      `Bearer ${REDACTED} recusado`,
    );
  });

  it('should describe a thrown value that carries no message', () => {
    expect(resolveHttpErrorMessage({ code: 42 }, createRequest(), 500)).toBe('Unknown error');
  });
});
