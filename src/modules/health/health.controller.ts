import { Controller, Get } from '@nestjs/common';
import {
    HealthCheck,
    HealthCheckService,
    TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { IsPublic } from 'src/common/decorators/public.decorator';
import { RedisHealthIndicator } from './indicators/redis.health';

@Controller('health')
export class HealthController {
    constructor(
        private readonly health: HealthCheckService,
        private readonly db: TypeOrmHealthIndicator,
        private readonly redis: RedisHealthIndicator,
    ) {}

    @Get()
    @IsPublic()
    @HealthCheck()
    check() {
        return this.health.check([
            () => this.db.pingCheck('database', { timeout: 3000 }),
            () => this.redis.isHealthy('redis'),
        ]);
    }

    @Get('live')
    @IsPublic()
    live() {
        return {
            status: 'ok',
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
        };
    }
}
