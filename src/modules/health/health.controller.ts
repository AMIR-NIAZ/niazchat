import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
    HealthCheck,
    HealthCheckService,
    TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { IsPublic } from 'src/common/decorators/public.decorator';
import { RedisHealthIndicator } from './indicators/redis.health';

@ApiTags('Health')
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
    @ApiOperation({
        summary: 'Readiness check (PostgreSQL + Redis)',
        description:
            'Returns 200 when the database and Redis are reachable, 503 otherwise.',
    })
    check() {
        return this.health.check([
            () => this.db.pingCheck('database', { timeout: 3000 }),
            () => this.redis.isHealthy('redis'),
        ]);
    }

    @Get('live')
    @IsPublic()
    @ApiOperation({ summary: 'Liveness check (no dependency checks)' })
    live() {
        return {
            status: 'ok',
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
        };
    }
}
