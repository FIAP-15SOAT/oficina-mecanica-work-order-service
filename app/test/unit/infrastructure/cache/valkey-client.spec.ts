import Redis from 'ioredis';

import { CACHE_COMMAND_TIMEOUT_MS, createCacheClient } from '@infrastructure/cache/valkey-client';

jest.mock('ioredis');

describe('createCacheClient', () => {
  it('should create the client with offline queue off, one retry and a 500 ms command timeout', () => {
    createCacheClient('redis://:secret@localhost:6379');

    expect(Redis).toHaveBeenCalledWith('redis://:secret@localhost:6379', {
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      commandTimeout: CACHE_COMMAND_TIMEOUT_MS,
    });
    expect(CACHE_COMMAND_TIMEOUT_MS).toBe(500);
  });

  it('should register an error listener that emits nothing', () => {
    const client = createCacheClient('redis://localhost:6379');
    const [event, listener] = jest.mocked(client.on).mock.calls[0] as [
      string,
      (error: Error) => unknown,
    ];

    expect(event).toBe('error');
    expect(listener(new Error('connect ECONNREFUSED'))).toBeUndefined();
  });
});
