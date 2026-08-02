import { Injectable } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';

import { RedisService } from '../redis/redis.service';

/**
 * Redis-backed throttle counters when Redis is available; otherwise memory.
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly memory = new Map<
    string,
    { totalHits: number; expiresAt: number }
  >();

  constructor(private readonly redis: RedisService) {}

  async increment(
    key: string,
    ttl: number,
    _limit: number,
    _blockDuration: number,
    _throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const redisHit = await this.redis.incrWithTtl(key, ttl);
    if (redisHit) {
      return {
        totalHits: redisHit.totalHits,
        timeToExpire: Math.ceil(redisHit.timeToExpire / 1000),
        isBlocked: false,
        timeToBlockExpire: 0,
      };
    }

    const now = Date.now();
    const current = this.memory.get(key);
    if (!current || current.expiresAt <= now) {
      this.memory.set(key, { totalHits: 1, expiresAt: now + ttl });
      return {
        totalHits: 1,
        timeToExpire: Math.ceil(ttl / 1000),
        isBlocked: false,
        timeToBlockExpire: 0,
      };
    }

    current.totalHits += 1;
    return {
      totalHits: current.totalHits,
      timeToExpire: Math.ceil((current.expiresAt - now) / 1000),
      isBlocked: false,
      timeToBlockExpire: 0,
    };
  }
}
