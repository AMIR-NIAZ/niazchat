import {
    BullRootModuleOptions,
    SharedBullConfigurationFactory,
} from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';

@Injectable()
export class RedisConfig implements SharedBullConfigurationFactory {
    createSharedConfiguration():
        | Promise<BullRootModuleOptions>
        | BullRootModuleOptions {

        return {
            connection: {
                host: process.env.REDIS_HOST ?? 'localhost',
                port: Number(process.env.REDIS_PORT ?? 6379),
            },
        };
    }
}
