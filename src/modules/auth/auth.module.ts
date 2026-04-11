import { Module } from '@nestjs/common';
import { AuthService } from './services/auth.service';
import { AuthController } from './controllers/auth.controller';
import { BullModule } from '@nestjs/bullmq';
import { OtpConsumer } from './processor/otp.processor';
import { MessageService } from 'src/common/services/message.service';
import { CacheService } from 'src/common/services/cache.service';
import { CacheModule } from '@nestjs/cache-manager';
import { OtpService } from './services/otp.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { JwtAppService } from './services/jwt.service';
import { JwtService } from '@nestjs/jwt';
import { UserService } from './services/user.service';
import { UserGateway } from './gateways/user.gateway';
import { UserController } from './controllers/user.controller';
import { Role } from './entities/role.entity';

@Module({
    imports: [
        BullModule.registerQueue({
            name: 'otp',
        }),
        CacheModule.register(),
        TypeOrmModule.forFeature([User, Role]),
    ],
    controllers: [AuthController, UserController],
    providers: [
        AuthService,
        UserService,
        OtpService,
        OtpConsumer,
        MessageService,
        CacheService,
        JwtAppService,
        JwtService,
        UserGateway,
    ],
})
export class AuthModule {}
