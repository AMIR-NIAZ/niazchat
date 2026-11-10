import {
    HttpException,
    HttpStatus,
    Injectable,
    OnModuleDestroy,
} from '@nestjs/common';
import Redis from 'ioredis';

interface MemoryCounter {
    count: number;
    expiresAt: number;
}

/**
 * Fixed-window counters for per-user limits, shared through Redis when it is
 * reachable and kept in memory otherwise (single-process dev / unit tests).
 * No new dependency: the same `ioredis` client already used by the forward
 * feature is created lazily and never blocks a request on a dead Redis.
 */
@Injectable()
export class RateLimitService implements OnModuleDestroy {
    private readonly redis: Redis | null;
    private readonly memory = new Map<string, MemoryCounter>();

    constructor() {
        const host = String(process.env.REDIS_HOST ?? '');
        const password = String(process.env.REDIS_PASSWORD ?? '');
        const tls = String(process.env.REDIS_TLS ?? '') === 'true';
        this.redis =
            host.trim() === ''
                ? null
                : new Redis({
                      host,
                      port: Number(process.env.REDIS_PORT ?? 6379),
                      ...(password !== '' ? { password } : {}),
                      ...(tls ? { tls: {} } : {}),
                      lazyConnect: true,
                      maxRetriesPerRequest: 1,
                      enableOfflineQueue: false,
                  });
        this.redis?.on('error', (): void => undefined);
    }

    async onModuleDestroy(): Promise<void> {
        if (this.redis !== null) {
            await this.redis.quit().catch((): void => undefined);
        }
    }

    /** Current counter for an exact key (0 when absent/expired). */
    async count(key: string): Promise<number> {
        const client = await this.client();
        if (client !== null) {
            const value = await client.get(key);
            return value === null ? 0 : Number(value) || 0;
        }
        const entry = this.memory.get(key);
        if (entry === undefined || entry.expiresAt <= Date.now()) {
            this.memory.delete(key);
            return 0;
        }
        return entry.count;
    }

    /** COUNT + INCR + EXPIRE on first hit; 429 when the limit is exceeded. */
    async consume(
        key: string,
        limit: number,
        windowSeconds: number,
        message: string,
    ): Promise<number> {
        const client = await this.client();
        let count: number;
        if (client !== null) {
            count = await client.incr(key);
            if (count === 1) {
                await client.expire(key, windowSeconds);
            }
        } else {
            const now = Date.now();
            const entry = this.memory.get(key);
            if (entry === undefined || entry.expiresAt <= now) {
                count = 1;
                this.memory.set(key, {
                    count: 1,
                    expiresAt: now + windowSeconds * 1000,
                });
            } else {
                entry.count += 1;
                count = entry.count;
            }
        }
        if (count > limit) {
            throw new HttpException(message, HttpStatus.TOO_MANY_REQUESTS);
        }
        return count;
    }

    /** Throws 429 when `key` already reached `limit`; never increments. */
    async assertUnderLimit(
        key: string,
        limit: number,
        message: string,
    ): Promise<void> {
        if ((await this.count(key)) >= limit) {
            throw new HttpException(message, HttpStatus.TOO_MANY_REQUESTS);
        }
    }

    /** Records one successful action (creations of existing chats omit this). */
    async increment(key: string, windowSeconds: number): Promise<void> {
        const client = await this.client();
        if (client !== null) {
            const count = await client.incr(key);
            if (count === 1) {
                await client.expire(key, windowSeconds);
            }
            return;
        }
        const now = Date.now();
        const entry = this.memory.get(key);
        if (entry === undefined || entry.expiresAt <= now) {
            this.memory.set(key, {
                count: 1,
                expiresAt: now + windowSeconds * 1000,
            });
            return;
        }
        entry.count += 1;
    }

    private async client(): Promise<Redis | null> {
        if (this.redis === null) {
            return null;
        }
        if (this.redis.status === 'ready') {
            return this.redis;
        }
        try {
            await this.redis.connect();
            return this.redis;
        } catch {
            return null;
        }
    }
}
