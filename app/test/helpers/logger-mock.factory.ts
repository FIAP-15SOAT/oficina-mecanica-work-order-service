import { ILogger } from '@application/ports/output/services/logger.service.interface';

export function createMockLogger(): jest.Mocked<ILogger> {
  const logger: jest.Mocked<ILogger> = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    event: jest.fn(),
    forContext: jest.fn(),
  };

  logger.forContext.mockReturnValue(logger);

  return logger;
}
