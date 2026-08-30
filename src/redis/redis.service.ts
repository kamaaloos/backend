import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private enabled = false;

  constructor(private readonly config: ConfigService) {}

  async connect() {
    const connection =
      this.config.get<string>('REDIS_URL')?.trim() ||
      (this.config.get('REDIS_HOST')
        ? `redis://${this.config.get('REDIS_HOST')}:${this.config.get('REDIS_PORT') ?? 6379}`
        : '');

    if (!connection) {
      this.logger.warn(
        'REDIS_URL not set — using in-memory fallbacks (single instance only). Add Redis before scaling the API.',
      );
      return;
    }

    try {
      this.client = new Redis(connection, {
        maxRetriesPerRequest: 1,
        lazyConnect: true,
        connectTimeout: 3000,
      });

      await this.client.connect();
      const pong = await this.client.ping();
      if (pong !== 'PONG') {
        throw new Error(`Unexpected ping response: ${pong}`);
      }

      this.enabled = true;
      this.logger.log(`Redis connected (${connection})`);
    } catch (err) {
      const message = (err as Error).message;
      this.logger.warn(
        `Redis unavailable (${message}) — falling back to memory (single instance only)`,
      );
      try {
        this.client?.disconnect();
      } catch {
        /* ignore */
      }
      this.client = null;
      this.enabled = false;
    }
  }

  isEnabled() {
    return this.enabled && !!this.client;
  }

  getClient() {
    return this.client;
  }

  /** Duplicate connection for Socket.IO Redis adapter pub/sub. */
  duplicate(): Redis | null {
    if (!this.client || !this.enabled) return null;
    return this.client.duplicate();
  }

  async incr(key: string): Promise<number | null> {
    if (!this.client || !this.enabled) return null;
    return this.client.incr(key);
  }

  async incrWithTtl(
    key: string,
    ttlMs: number,
  ): Promise<{ totalHits: number; timeToExpire: number } | null> {
    if (!this.client || !this.enabled) return null;

    const multi = this.client.multi();
    multi.incr(key);
    multi.pttl(key);
    const results = await multi.exec();
    if (!results) return null;

    const totalHits = Number(results[0]?.[1] ?? 0);
    let timeToExpire = Number(results[1]?.[1] ?? -1);

    if (timeToExpire < 0) {
      await this.client.pexpire(key, ttlMs);
      timeToExpire = ttlMs;
    }

    return { totalHits, timeToExpire };
  }

  async onModuleDestroy() {
    if (this.client) {
      try {
        await this.client.quit();
      } catch {
        this.client.disconnect();
      }
      this.client = null;
      this.enabled = false;
    }
  }
}
