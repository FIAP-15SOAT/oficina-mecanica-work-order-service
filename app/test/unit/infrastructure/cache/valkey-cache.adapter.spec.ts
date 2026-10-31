import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

import { ILogger } from '@application/ports/output/services/logger.service.interface';
import { ValkeyCacheAdapter } from '@infrastructure/cache/valkey-cache.adapter';
import { createCacheClient } from '@infrastructure/cache/valkey-client';
import { TECHNICAL_EVENTS } from '@infrastructure/logging/technical-event.catalog';

import { createMockLogger } from '../../../helpers/logger-mock.factory';

jest.mock('@infrastructure/cache/valkey-client');

const CACHE_URL = 'redis://:secret@localhost:6379';
const TTL_SECONDS = 60;

type MockClient = jest.Mocked<Pick<Redis, 'get' | 'set' | 'del' | 'quit' | 'disconnect'>>;

function createMockClient(): MockClient {
  return {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    quit: jest.fn(),
    disconnect: jest.fn(),
  };
}

describe('ValkeyCacheAdapter', () => {
  let client: MockClient;
  let logger: jest.Mocked<ILogger>;
  let adapter: ValkeyCacheAdapter;

  beforeEach(() => {
    client = createMockClient();
    logger = createMockLogger();
    jest.mocked(createCacheClient).mockReturnValue(client as unknown as Redis);
    adapter = new ValkeyCacheAdapter(
      new ConfigService({ CACHE_URL, CACHE_TTL_SECONDS: String(TTL_SECONDS) }),
      logger,
    );
  });

  describe('constructor', () => {
    it('should create the client from CACHE_URL', () => {
      expect(createCacheClient).toHaveBeenCalledWith(CACHE_URL);
    });

    it('should fail when CACHE_URL is missing', () => {
      expect(() => new ValkeyCacheAdapter(new ConfigService({}), logger)).toThrow('CACHE_URL');
    });

    it('should default the ttl to 43200 seconds', async () => {
      client.set.mockResolvedValueOnce('OK');

      await new ValkeyCacheAdapter(new ConfigService({ CACHE_URL }), logger).set('k', 'v');

      expect(client.set).toHaveBeenCalledWith('k', 'v', 'EX', 43_200);
    });

    it.each(['', '  '])(
      'should default the ttl when CACHE_TTL_SECONDS is blank (%p)',
      async (ttl) => {
        client.set.mockResolvedValueOnce('OK');

        await new ValkeyCacheAdapter(
          new ConfigService({ CACHE_URL, CACHE_TTL_SECONDS: ttl }),
          logger,
        ).set('k', 'v');

        expect(client.set).toHaveBeenCalledWith('k', 'v', 'EX', 43_200);
      },
    );

    it.each(['abc', '0', '-60', '1.5', '1e16'])(
      'should fail when CACHE_TTL_SECONDS is not a positive integer (%p)',
      (ttl) => {
        expect(
          () =>
            new ValkeyCacheAdapter(
              new ConfigService({ CACHE_URL, CACHE_TTL_SECONDS: ttl }),
              logger,
            ),
        ).toThrow(`CACHE_TTL_SECONDS inválido: "${ttl}"`);
      },
    );
  });

  describe('get', () => {
    it('should return the cached value', async () => {
      client.get.mockResolvedValueOnce('value');

      await expect(adapter.get('k')).resolves.toBe('value');
      expect(client.get).toHaveBeenCalledWith('k');
    });

    it('should return null on a miss', async () => {
      client.get.mockResolvedValueOnce(null);

      await expect(adapter.get('k')).resolves.toBeNull();
      expect(logger.event).not.toHaveBeenCalled();
    });

    it.each([new Error('connect ECONNREFUSED'), new Error('Command timed out')])(
      'should return null and log cache.unavailable when get fails (%s)',
      async (error) => {
        client.get.mockRejectedValueOnce(error);

        await expect(adapter.get('k')).resolves.toBeNull();
        expect(logger.event).toHaveBeenCalledWith(TECHNICAL_EVENTS.CACHE_UNAVAILABLE, {}, error);
      },
    );
  });

  describe('set', () => {
    it('should set every key with EX and the configured ttl', async () => {
      client.set.mockResolvedValueOnce('OK');

      await adapter.set('k', 'v');

      expect(client.set).toHaveBeenCalledWith('k', 'v', 'EX', TTL_SECONDS);
      expect(logger.event).not.toHaveBeenCalled();
    });

    it('should use the given ttl instead of the configured one', async () => {
      client.set.mockResolvedValueOnce('OK');

      await adapter.set('k', 'v', 30);

      expect(client.set).toHaveBeenCalledWith('k', 'v', 'EX', 30);
    });

    it('should log cache.unavailable and resolve when set fails', async () => {
      const error = new Error('Command timed out');
      client.set.mockRejectedValueOnce(error);

      await expect(adapter.set('k', 'v')).resolves.toBeUndefined();
      expect(logger.event).toHaveBeenCalledWith(TECHNICAL_EVENTS.CACHE_UNAVAILABLE, {}, error);
    });
  });

  describe('delete', () => {
    it('should delete all keys in one call', async () => {
      client.del.mockResolvedValueOnce(2);

      await adapter.delete(['a', 'b']);

      expect(client.del).toHaveBeenCalledTimes(1);
      expect(client.del).toHaveBeenCalledWith('a', 'b');
      expect(logger.event).not.toHaveBeenCalled();
    });

    it('should log cache.invalidation_failed and resolve when delete fails', async () => {
      const error = new Error('connect ECONNREFUSED');
      client.del.mockRejectedValueOnce(error);

      await expect(adapter.delete(['a'])).resolves.toBeUndefined();
      expect(logger.event).toHaveBeenCalledWith(
        TECHNICAL_EVENTS.CACHE_INVALIDATION_FAILED,
        {},
        error,
      );
    });

    it('should skip delete for an empty key list', async () => {
      await adapter.delete([]);

      expect(client.del).not.toHaveBeenCalled();
    });
  });

  describe('onApplicationShutdown', () => {
    it('should quit the client on application shutdown', async () => {
      client.quit.mockResolvedValueOnce('OK');

      await adapter.onApplicationShutdown();

      expect(client.quit).toHaveBeenCalledTimes(1);
      expect(client.disconnect).not.toHaveBeenCalled();
    });

    it('should disconnect and resolve when quit fails with the server unreachable', async () => {
      client.quit.mockRejectedValueOnce(
        new Error("Stream isn't writeable and enableOfflineQueue options is false"),
      );

      await expect(adapter.onApplicationShutdown()).resolves.toBeUndefined();
      expect(client.disconnect).toHaveBeenCalledTimes(1);
    });
  });
});
