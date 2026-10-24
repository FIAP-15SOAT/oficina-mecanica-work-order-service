import Redis from 'ioredis';

// A Valkey that accepts TCP and never answers must fall back to the database, not hang the read.
export const CACHE_COMMAND_TIMEOUT_MS = 500;

export function createCacheClient(url: string): Redis {
  const client = new Redis(url, {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    commandTimeout: CACHE_COMMAND_TIMEOUT_MS,
  });

  // Connection errors also reject the pending command, which is where they are logged.
  client.on('error', () => undefined);

  return client;
}
