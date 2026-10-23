import { Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import Redis from 'ioredis';

/**
 * Checks Redis using exactly the connection settings BullMQ is configured with
 * (see src/common/configs/redis.config.ts).
 */
@Injectable()
export class RedisHealthIndicator {
    constructor(
        private readonly healthIndicatorService: HealthIndicatorService,
    ) {}

    async isHealthy(key = 'redis') {
        const indicator = this.healthIndicatorService.check(key);
        const password = process.env.REDIS_PASSWORD;

        const client = new Redis({
            host: process.env.REDIS_HOST ?? 'localhost',
            port: Number(process.env.REDIS_PORT ?? 6379),
            ...(password ? { password } : {}),
            ...(process.env.REDIS_TLS === 'true' ? { tls: {} } : {}),
            lazyConnect: true,
            connectTimeout: 3000,
            maxRetriesPerRequest: 1,
            retryStrategy: () => null,
        });
        client.on('error', () => undefined);

        try {
            await client.connect();
            const pong = await client.ping();

            if (pong !== 'PONG') {
                return indicator.down({
                    message: `unexpected PING response: ${pong}`,
                });
            }

            return indicator.up();
        } catch (error) {
            return indicator.down({
                message: error instanceof Error ? error.message : String(error),
            });
        } finally {
            client.disconnect();
        }
    }
}
