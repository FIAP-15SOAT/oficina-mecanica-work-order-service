import { reportBootstrapFailure } from '@infrastructure/logging/bootstrap-failure';
import { DECLARED_FIELD_NAMES, RESOURCE_FIELDS } from '@infrastructure/logging/field-registry';
import { captureDiagnostics } from '../../../helpers/diagnostics-capture';

function capture(): { write: jest.Mock; lines: () => Record<string, unknown>[] } {
  const write = jest.fn().mockReturnValue(true);

  return {
    write,
    lines: () =>
      write.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>),
  };
}

describe('reportBootstrapFailure', () => {
  it('should emit a single JSON line in the declared envelope', () => {
    const target = capture();

    reportBootstrapFailure(new Error('conexão recusada'), target);

    const [line] = target.lines();

    expect(target.write).toHaveBeenCalledTimes(1);
    expect(String(target.write.mock.calls[0][0]).endsWith('\n')).toBe(true);
    expect(line).toMatchObject({
      level: 'error',
      message: 'application failed to start',
      'oficina.event.name': 'app.bootstrap.failed',
      'exception.type': 'Error',
      'exception.message': 'conexão recusada',
    });
    expect(line.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('should emit no key outside the declared field dictionary', () => {
    const target = capture();

    reportBootstrapFailure(new Error('falhou'), target);

    const undeclared = Object.keys(target.lines()[0]).filter(
      (key) => !DECLARED_FIELD_NAMES.has(key),
    );

    expect(undeclared).toEqual([]);
  });

  /**
   * The fatal path escaped the whole redaction: Node dumped the raw stack.
   * That is exactly the exception that can carry a connection credential.
   */
  it('should sanitize the fatal error before writing it', () => {
    const target = capture();

    reportBootstrapFailure(
      new Error('falha em postgresql://app:S3nh4Secreta@db:5432/oficina (maria.silva@gmail.com)'),
      target,
    );

    const serialized = JSON.stringify(target.lines()[0]);

    expect(serialized).not.toContain('S3nh4Secreta');
    expect(serialized).not.toContain('maria.silva@gmail.com');
  });

  it('should describe a rejection that is not an Error at all', () => {
    const target = capture();

    reportBootstrapFailure('falhou sem Error', target);

    expect(target.lines()[0]['exception.message']).toBe('falhou sem Error');
  });

  it('should never throw when the destination itself fails', () => {
    const target = {
      write: () => {
        throw new Error('EPIPE');
      },
    };

    expect(() => {
      reportBootstrapFailure(new Error('falhou'), target);
    }).not.toThrow();
  });

  /**
   * Without the resource attributes, the very line someone reads when the pod
   * does not start would be the only one impossible to attribute to a service,
   * a version or an environment in a shared collector.
   */
  it('should carry the same resource attributes as every other line', () => {
    const target = capture();

    reportBootstrapFailure(new Error('falhou'), target);

    const [line] = target.lines();

    for (const { name } of RESOURCE_FIELDS) {
      expect(line[name]).toBeDefined();
    }

    expect(line['service.name']).toBe('oficina-mecanica-work-order-service');
  });

  /**
   * The docs present `LOG_LEVEL=silent` as turning output off without a deploy.
   * A kill switch with an undocumented exception is worse than one without — and
   * the failure stays visible through exit code 1.
   */
  it('should honour the silent kill switch', () => {
    const previous = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = 'silent';

    const target = capture();

    try {
      reportBootstrapFailure(new Error('falhou'), target);
    } finally {
      process.env.LOG_LEVEL = previous;
    }

    expect(target.write).not.toHaveBeenCalled();
  });

  it('should report a write failure through the stderr diagnostic', () => {
    const stderr = captureDiagnostics();

    reportBootstrapFailure(new Error('falhou'), {
      write: () => {
        throw new Error('EPIPE');
      },
    });

    expect(String(stderr.spy.mock.calls[0][0])).toContain(
      '"oficina.logging.failure.stage":"bootstrap"',
    );

    stderr.restore();
  });

  it('should default to stdout when no target is given', () => {
    const stdout = jest.spyOn(process.stdout, 'write').mockReturnValue(true);

    reportBootstrapFailure(new Error('falhou'));

    expect(stdout).toHaveBeenCalledTimes(1);
    expect(String(stdout.mock.calls[0][0])).toContain('app.bootstrap.failed');

    stdout.mockRestore();
  });
});
