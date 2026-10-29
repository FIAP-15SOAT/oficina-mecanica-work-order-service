import type { Server } from 'http';
import { INestApplication, Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { APP_FILTER } from '@nestjs/core';
import request from 'supertest';
import { AllExceptionsFilter } from '../../src/infrastructure/http/filters/all-exceptions.filter';
import { createMockLogger } from '../helpers/logger-mock.factory';

@Controller('_test-exceptions')
class TestExceptionController {
  @Get('raw-error')
  throwRawError(): never {
    throw new Error('raw error for testing');
  }

  @Get('non-error-throw')
  throwNonError(): never {
    throw 'a plain string exception';
  }

  @Get('string-http-exception')
  throwStringHttpException(): never {
    throw new HttpException('plain string message', HttpStatus.BAD_REQUEST);
  }

  @Get('unmapped-status')
  throwUnmappedStatus(): never {
    throw new HttpException('Custom error', 418);
  }

  @Get('syntax-error-with-body')
  throwSyntaxErrorWithBody(): never {
    const err = new SyntaxError('Unexpected token');
    (err as unknown as Record<string, unknown>)['body'] = '{invalid}';
    throw err;
  }
}

describe('AllExceptionsFilter (E2E)', () => {
  let app: INestApplication;
  let httpServer: Server;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      controllers: [TestExceptionController],
      providers: [
        { provide: 'ILogger', useValue: createMockLogger() },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    httpServer = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  it('should return 500 with generic message for an unhandled raw Error', async () => {
    const res = await request(httpServer).get('/_test-exceptions/raw-error').expect(500);

    expect(res.body).toEqual({
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'Ocorreu um erro inesperado.',
    });
  });

  it('should return 500 with generic message when a non-Error value is thrown', async () => {
    const res = await request(httpServer).get('/_test-exceptions/non-error-throw').expect(500);

    expect(res.body).toEqual({
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'Ocorreu um erro inesperado.',
    });
  });

  it('should return the exception.message when HttpException response is a plain string', async () => {
    const res = await request(httpServer)
      .get('/_test-exceptions/string-http-exception')
      .expect(400);

    expect(res.body).toEqual({
      statusCode: 400,
      error: 'Bad Request',
      message: 'plain string message',
    });
  });

  it('should use "Error" as error field for unmapped HTTP status codes', async () => {
    const res = await request(httpServer).get('/_test-exceptions/unmapped-status').expect(418);

    expect(res.body.error).toBe('Error');
    expect(res.body.statusCode).toBe(418);
  });

  it('should return 400 with "Bad request" message for a SyntaxError with body property', async () => {
    const res = await request(httpServer)
      .get('/_test-exceptions/syntax-error-with-body')
      .expect(400);

    expect(res.body).toEqual({
      statusCode: 400,
      error: 'Bad Request',
      message: 'Requisição inválida.',
    });
  });
});
