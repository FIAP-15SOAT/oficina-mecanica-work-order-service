import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

import { ICache } from '@application/ports/output/cache.service.interface';
import { ILogger } from '@application/ports/output/logger.service.interface';
import { TECHNICAL_EVENTS } from '@infrastructure/logging/technical-event.catalog';

import { createCacheClient } from './valkey-client';

//12 hours in seconds
const DEFAULT_CACHE_TTL_SECONDS = 43_200;

@Injectable()
export class ValkeyCacheAdapter implements ICache, OnApplicationShutdown {
  private readonly client: Redis;
  private readonly ttlSeconds: number;

  constructor(
    config: ConfigService,
    @Inject('ILogger') private readonly logger: ILogger,
  ) {
    this.client = createCacheClient(config.getOrThrow<string>('CACHE_URL'));
    this.ttlSeconds = this.resolveTtlSeconds(config.get<string>('CACHE_TTL_SECONDS'));
  }

  async get(key: string): Promise<string | null> {
    try {
      return await this.client.get(key);
    } catch (error) {
      this.logger.event(TECHNICAL_EVENTS.CACHE_UNAVAILABLE, {}, error);

      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds = this.ttlSeconds): Promise<void> {
    try {
      await this.client.set(key, value, 'EX', ttlSeconds);
    } catch (error) {
      this.logger.event(TECHNICAL_EVENTS.CACHE_UNAVAILABLE, {}, error);
    }
  }

  async delete(keys: readonly string[]): Promise<void> {
    if (keys.length === 0) {
      return;
    }

    try {
      await this.client.del(...keys);
    } catch (error) {
      this.logger.event(TECHNICAL_EVENTS.CACHE_INVALIDATION_FAILED, {}, error);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    // With the offline queue off, quit rejects while the server is unreachable and leaves the
    // client reconnecting; a rejected hook would also skip the shutdown hooks that follow.
    await this.client.quit().catch(() => this.client.disconnect());
  }

  // A ttl that is not a positive safe integer makes every SET fail, logged as an unavailable cache.
  private resolveTtlSeconds(value: string | undefined): number {
    const raw = value?.trim();

    if (!raw) {
      return DEFAULT_CACHE_TTL_SECONDS;
    }

    const ttlSeconds = Number(raw);

    if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1) {
      throw new Error(`CACHE_TTL_SECONDS inválido: "${value}"`);
    }

    return ttlSeconds;
  }
}
