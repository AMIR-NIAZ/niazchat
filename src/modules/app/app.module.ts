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
import { AttachmentsModule } from '../attachments/attachments.module';
import { PayloadGuard } from 'src/common/guards/restGuards/payload.guard';
import { RoleGurd } from 'src/common/guards/restGuards/role.guard';
import { SeedersModule } from 'src/modules/seeders/seeders.module';
import { HealthModule } from '../health/health.module';
import { MediaModule } from '../media/media.module';
import { AVATAR_THUMBNAIL_CACHE_CONTROL } from '../media/avatar-thumbnail.util';

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
            // Resolved from the cwd on purpose: it must match the directory
            // multer writes to (`uploads/avatars`, also cwd-relative), so the
            // served URL and the stored path can never diverge when the
            // compiled app is started from a different working directory.
            rootPath: join(process.cwd(), 'uploads'),
            serveRoot: '/uploads',
            // Avatar/group-photo file names are unique per upload and never
            // reused, so the originals are immutable: cache them for a year
            // instead of refetching on every screen. Old clients keep working
            // (same URLs, only headers changed).
            serveStaticOptions: {
                setHeaders: (res): void => {
                    res.setHeader(
                        'Cache-Control',
                        AVATAR_THUMBNAIL_CACHE_CONTROL,
                    );
                },
            },
        }),
        JwtModule.register({}),
        SeedersModule,
        HealthModule,
        AuthModule,
        ChatsModule,
        MessageModule,
        ReactionsModule,
        AttachmentsModule,
        MediaModule,
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
