import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from '../auth/auth.module';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TypeOrmConfig } from 'src/common/configs/typeorm.config';
import { RedisConfig } from 'src/common/configs/redis.config';
import { APP_GUARD } from '@nestjs/core';
import { JwtAppService } from '../auth/services/jwt.service';
import { JwtModule } from '@nestjs/jwt';
import { join } from 'path';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ChatsModule } from '../chats/chats.module';
import { MessageModule } from '../messages/message.module';
import { ReactionsModule } from '../reactions/reaction.module';
import { PayloadGuard } from 'src/common/guards/restGuards/payload.guard';
import { RoleGurd } from 'src/common/guards/restGuards/role.guard';
import { SeedersModule } from 'src/modules/seeders/seeders.module';

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
        }),
        TypeOrmModule.forRootAsync({
            useClass: TypeOrmConfig,
        }),
        BullModule.forRootAsync({
            useClass: RedisConfig,
        }),
        ServeStaticModule.forRoot({
            rootPath: join(__dirname, '..', '..', '..', 'uploads'),
            serveRoot: '/uploads',
        }),
        JwtModule.register({}),
        SeedersModule,
        AuthModule,
        ChatsModule,
        MessageModule,
        ReactionsModule,
    ],
    controllers: [AppController],
    providers: [
        AppService,
        JwtAppService,
        {
            provide: APP_GUARD,
            useClass: PayloadGuard,
        },
        {
            provide: APP_GUARD,
            useClass: RoleGurd,
        },
    ],
})
class AppModule {}

export default AppModule;
