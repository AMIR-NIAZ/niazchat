import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

/** One stored value plus its absolute expiry (memory fallback only). */
interface MemoryEntry {
    value: string;
    expiresAt: number;
}

/**
 * Short-lived key/value cache for state that must outlive a single request —
 * today the pending OTP codes.
 *
 * Backed by Redis when `REDIS_HOST` is configured (the same lazy `ioredis`
 * client the rate limiter uses), so a code written by one app instance/process
 * is visible to every other one and is NOT lost when the app restarts. Without
 * Redis (unit tests, bare local run) an in-memory map with the same TTL
 * semantics is used.
 *
 * TTLs are expressed in SECONDS and converted exactly once, here.
 */
@Injectable()
export class CacheService implements OnModuleDestroy {
    private readonly logger = new Logger(CacheService.name);
    private readonly redis: Redis | null;
    private readonly memory = new Map<string, MemoryEntry>();
    private redisUnavailableLogged = false;

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

        this.logger.log(
            `Cache store: ${this.redis === null ? 'memory (REDIS_HOST is not set)' : `redis ${host}:${process.env.REDIS_PORT ?? 6379}`}`,
        );
    }

    async onModuleDestroy(): Promise<void> {
        if (this.redis !== null) {
            await this.redis.quit().catch((): void => undefined);
        }
    }

    /** Stores `data` under `key` for `ttlSeconds`. */
    async set(key: string, data: unknown, ttlSeconds: number): Promise<void> {
        const ttlMs = Math.max(1, Math.round(ttlSeconds * 1000));
        const payload = JSON.stringify(data);
        const client = await this.client();

        this.logger.debug(
            `set key="${key}" ttl=${ttlSeconds}s store=${client === null ? 'memory' : 'redis'}`,
        );

        if (client !== null) {
            await client.set(key, payload, 'PX', ttlMs);
            return;
        }

        this.memory.set(key, {
            value: payload,
            expiresAt: Date.now() + ttlMs,
        });
    }

    /** Returns the stored value, or `undefined` when absent/expired. */
    async get(key: string): Promise<unknown> {
        const client = await this.client();
        const raw =
            client !== null ? await client.get(key) : this.memoryGet(key);

        this.logger.debug(
            `get key="${key}" store=${client === null ? 'memory' : 'redis'} hit=${raw !== null && raw !== undefined}`,
        );

        return raw === null || raw === undefined ? undefined : this.decode(raw);
    }

    async del(key: string): Promise<boolean> {
        const client = await this.client();
        if (client !== null) {
            return (await client.del(key)) > 0;
        }
        return this.memory.delete(key);
    }

    private memoryGet(key: string): string | null {
        const entry = this.memory.get(key);
        if (entry === undefined) {
            return null;
        }
        if (entry.expiresAt <= Date.now()) {
            this.memory.delete(key);
            return null;
        }
        return entry.value;
    }

    private decode(raw: string): unknown {
        try {
            return JSON.parse(raw);
        } catch {
            return raw;
        }
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
            if (!this.redisUnavailableLogged) {
                this.redisUnavailableLogged = true;
                this.logger.warn(
                    'Redis is unreachable; falling back to the in-memory cache (codes will not be shared across instances or survive a restart).',
                );
            }
            return null;
        }
    }
}
