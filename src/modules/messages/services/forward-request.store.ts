import {
    Injectable,
    OnModuleDestroy,
    ServiceUnavailableException,
} from '@nestjs/common';
import Redis from 'ioredis';
import {
    FORWARD_IDEMPOTENCY_TTL_SECONDS,
    MAX_FORWARD_REQUESTS_PER_MINUTE,
} from '../dtos/forwardMessages.dto';

interface MemoryEntry {
    value: string;
    expiresAt: number;
}

const PROCESSING = '__processing__';
const WAIT_ATTEMPTS = 100;
const WAIT_INTERVAL_MS = 100;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Forward request dedupe + rate limit. Redis is the shared store; a small
 * in-memory fallback keeps a single-process dev backend (or a unit test)
 * working when Redis is unavailable.
 */
@Injectable()
export class ForwardRequestStore implements OnModuleDestroy {
    private readonly redis: Redis | null;
    private readonly memory = new Map<string, MemoryEntry>();
    private readonly rate = new Map<
        string,
        { count: number; resetAt: number }
    >();

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

    /**
     * Runs `run` once per key for the idempotency window. A duplicate request
     * either returns the stored result or waits for the concurrent runner.
     */
    async runIdempotent<T>(
        key: string,
        run: () => Promise<T>,
    ): Promise<{ value: T; cached: boolean }> {
        const client = await this.client();
        if (client !== null) {
            const acquired = await client.set(
                key,
                PROCESSING,
                'PX',
                FORWARD_IDEMPOTENCY_TTL_SECONDS * 1000,
                'NX',
            );
            if (acquired !== 'OK') {
                return {
                    value: await this.waitForRedis<T>(client, key),
                    cached: true,
                };
            }
            try {
                const value = await run();
                await client.set(
                    key,
                    JSON.stringify(value),
                    'PX',
                    FORWARD_IDEMPOTENCY_TTL_SECONDS * 1000,
                );
                return { value, cached: false };
            } catch (error) {
                await client.del(key).catch((): void => undefined);
                throw error;
            }
        }

        this.pruneMemory();
        const existing = this.memory.get(key);
        if (existing !== undefined && existing.value !== PROCESSING) {
            return {
                value: JSON.parse(existing.value) as T,
                cached: true,
            };
        }
        if (existing !== undefined) {
            for (let attempt = 0; attempt < WAIT_ATTEMPTS; attempt += 1) {
                await sleep(WAIT_INTERVAL_MS);
                this.pruneMemory();
                const entry = this.memory.get(key);
                if (entry === undefined) {
                    return this.runIdempotent(key, run);
                }
                if (entry.value !== PROCESSING) {
                    return {
                        value: JSON.parse(entry.value) as T,
                        cached: true,
                    };
                }
            }
            throw new ServiceUnavailableException(
                'A forward request with this id is still in progress',
            );
        }

        this.memory.set(key, {
            value: PROCESSING,
            expiresAt: Date.now() + FORWARD_IDEMPOTENCY_TTL_SECONDS * 1000,
        });
        try {
            const value = await run();
            this.memory.set(key, {
                value: JSON.stringify(value),
                expiresAt: Date.now() + FORWARD_IDEMPOTENCY_TTL_SECONDS * 1000,
            });
            return { value, cached: false };
        } catch (error) {
            this.memory.delete(key);
            throw error;
        }
    }

    /** Per-user sliding minute limit for forward requests. */
    async assertRateLimit(userId: number): Promise<void> {
        const bucket = Math.floor(Date.now() / 60_000);
        const key = `forward:rate:${userId}:${bucket}`;
        const client = await this.client();
        let count: number;
        if (client !== null) {
            count = await client.incr(key);
            if (count === 1) {
                await client.expire(key, 120);
            }
        } else {
            const now = Date.now();
            const entry = this.rate.get(key);
            if (entry === undefined || entry.resetAt <= now) {
                count = 1;
                this.rate.set(key, { count: 1, resetAt: now + 60_000 });
            } else {
                entry.count += 1;
                count = entry.count;
            }
        }
        if (count > MAX_FORWARD_REQUESTS_PER_MINUTE) {
            throw new ServiceUnavailableException(
                'Too many forward requests. Try again in a minute.',
            );
        }
    }

    private async waitForRedis<T>(client: Redis, key: string): Promise<T> {
        for (let attempt = 0; attempt < WAIT_ATTEMPTS; attempt += 1) {
            const raw = await client.get(key);
            if (raw !== null && raw !== PROCESSING) {
                return JSON.parse(raw) as T;
            }
            if (raw === null) {
                throw new ServiceUnavailableException(
                    'Forward request expired before it completed',
                );
            }
            await sleep(WAIT_INTERVAL_MS);
        }
        throw new ServiceUnavailableException(
            'A forward request with this id is still in progress',
        );
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

    private pruneMemory(): void {
        const now = Date.now();
        for (const [key, entry] of this.memory) {
            if (entry.expiresAt <= now) {
                this.memory.delete(key);
            }
        }
    }
}
