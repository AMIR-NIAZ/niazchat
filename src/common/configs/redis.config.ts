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
                host: 'localhost',
                port: 6379,
            },
        };
    }
}
