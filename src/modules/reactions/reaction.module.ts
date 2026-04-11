import { Module } from '@nestjs/common';
import { ReactionsGateway } from './gateways/reactions.gateway';
import { ReactionsService } from './services/reactions.service';
import { ReactionController } from './controllers/reaction.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../auth/entities/user.entity';
import { Message } from '../messages/entities/message.entity';
import { React } from './entities/react.entity';
import { MessageReact } from './entities/message_react.entity';
import { JwtAppService } from '../auth/services/jwt.service';
import { JwtService } from '@nestjs/jwt';

@Module({
    imports: [TypeOrmModule.forFeature([User, Message, React, MessageReact])],
    providers: [ReactionsGateway, ReactionsService, JwtAppService, JwtService],
    controllers: [ReactionController],
})
export class ReactionsModule {}
