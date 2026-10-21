import {
  DESTINATION_FAILURE_POLICY,
  reportDestinationFailure,
  reportLoggingFailure,
  runSafely,
  runSafelyVoid,
} from '@infrastructure/logging/logging-diagnostics';
import { resolveLoggerConfig } from '@infrastructure/logging/logger.config';

import {
  captureDiagnostics,
  DiagnosticsCapture,
  failDiagnostics,
} from '../../../helpers/diagnostics-capture';

function captureStderr(): DiagnosticsCapture {
  return captureDiagnostics();
}

function writtenLines(stderr: DiagnosticsCapture): Record<string, unknown>[] {
  return stderr.lines();
}

describe('reportLoggingFailure', () => {
  it('should write a single fixed JSON line to stderr', () => {
    const stderr = captureStderr();

    reportLoggingFailure('sanitization');

    expect(stderr.spy).toHaveBeenCalledTimes(1);
    expect(writtenLines(stderr)[0]).toMatchObject({
      timestamp: expect.any(String),
      level: 'error',
      message: 'logging failure',
      'oficina.logging.failure.stage': 'sanitization',
    });

    stderr.restore();
  });

  /**
   * A linha de diagnóstico carrega o nome do campo e o tipo do erro, nunca o
   * valor: ela não pode virar a via de vazamento que a redação existe para
   * evitar.
   */
  it('should carry the field and the error type but never a value', () => {
    const stderr = captureStderr();

    reportLoggingFailure('emit', { field: 'unknownField', errorType: 'TypeError' });

    expect(writtenLines(stderr)[0]).toMatchObject({
      'oficina.logging.failure.field': 'unknownField',
      'oficina.logging.failure.error_type': 'TypeError',
    });

    stderr.restore();
  });

  it('should stay silent when writing the diagnostic itself fails', () => {
    const stderr = failDiagnostics();

    expect(() => reportLoggingFailure('serialization')).not.toThrow();

    stderr.restore();
  });
});

/**
 * O pino transforma `EPIPE` em no-op silencioso, que é exatamente o modo de
 * falha "rodando cego e ninguém percebe". A política declarada é continuar
 * degradado com uma única linha em stderr — uma por processo, para que um
 * stdout quebrado não vire uma tempestade no stderr.
 */
describe('reportDestinationFailure', () => {
  // O sinalizador de "já reportei" é por processo. Cada arquivo de spec tem seu
  // próprio registro de módulos e nenhum outro teste daqui aciona esta função,
  // então esta é de fato a primeira falha de destino do processo.
  it('should report the declared policy on the first destination failure only', () => {
    const stderr = captureStderr();

    reportDestinationFailure();
    reportDestinationFailure();
    reportDestinationFailure();

    expect(stderr.spy).toHaveBeenCalledTimes(1);
    expect(writtenLines(stderr)[0]).toMatchObject({
      'oficina.logging.failure.stage': 'destination',
      'oficina.logging.failure.policy': DESTINATION_FAILURE_POLICY,
    });

    stderr.restore();
  });

  it('should declare continue-degraded as the policy', () => {
    expect(DESTINATION_FAILURE_POLICY).toBe('continue-degraded');
  });
});

describe('runSafely', () => {
  it('should return the operation result when nothing throws', () => {
    expect(runSafely('emit', () => 'ok', 'fallback')).toBe('ok');
  });

  it('should return the fallback and report the error type when the operation throws', () => {
    const stderr = captureStderr();

    const result = runSafely(
      'access-log',
      () => {
        throw new TypeError('quebrou');
      },
      'fallback',
    );

    expect(result).toBe('fallback');
    expect(writtenLines(stderr)[0]).toMatchObject({
      'oficina.logging.failure.stage': 'access-log',
      'oficina.logging.failure.error_type': 'TypeError',
    });

    stderr.restore();
  });

  it('should describe a thrown non-error by its type', () => {
    const stderr = captureStderr();

    runSafely(
      'config',
      () => {
        throw 'texto solto';
      },
      undefined,
    );

    expect(writtenLines(stderr)[0]).toMatchObject({
      'oficina.logging.failure.error_type': 'string',
    });

    stderr.restore();
  });
});

describe('runSafelyVoid', () => {
  it('should run the operation when nothing throws', () => {
    const operation = jest.fn();

    runSafelyVoid('emit', operation);

    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('should absorb the failure and report it', () => {
    const stderr = captureStderr();

    expect(() =>
      runSafelyVoid('emit', () => {
        throw new Error('quebrou');
      }),
    ).not.toThrow();
    expect(stderr.spy).toHaveBeenCalledTimes(1);

    stderr.restore();
  });
});

/**
 * Medido: um `EPIPE` no stderr — o coletor fechando o pipe — chega de forma
 * **assíncrona**, fora do `try/catch` do escritor, e derrubava o processo com
 * exceção não capturada. O oposto exato da política `continue-degraded`. O
 * listener é simétrico ao que o destino de stdout já registra, e pelo mesmo
 * motivo: evento `'error'` sem listener em stream do Node mata o processo.
 */
describe('canal de diagnóstico — resiliência do stderr', () => {
  it('should keep an error listener registered on stderr', () => {
    expect(process.stderr.listenerCount('error')).toBeGreaterThan(0);
  });

  it('should not throw when stderr emits an asynchronous error', () => {
    expect(() => process.stderr.emit('error', new Error('EPIPE'))).not.toThrow();
  });

  /**
   * Num destino compartilhado, uma linha sem `service.*` é impossível de
   * atribuir — e esta pode ser o único sinal restante quando o stdout falhou.
   */
  it('should carry the resource attributes that identify the origin', () => {
    const stderr = captureStderr();

    reportLoggingFailure('emit', { field: 'quoteId' });

    const [line] = writtenLines(stderr);

    for (const name of Object.keys(resolveLoggerConfig().resource)) {
      expect(line[name]).toBeDefined();
    }

    expect(line['service.name']).toBe('oficina-mecanica-work-order-service');
    expect(line['deployment.environment.name']).toBeDefined();
    expect(line['oficina.logging.failure.field']).toBe('quoteId');

    stderr.restore();
  });
});
