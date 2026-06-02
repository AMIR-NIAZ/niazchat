import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Message } from './entities/message.entity';
import { MessageGateway } from './gateways/message.gateway';
import { MessageService } from './services/message.service';
import { ChatMember } from '../chats/entities/chat_members.entity';
import { Chat } from '../chats/entities/chat.entity';
import { User } from '../auth/entities/user.entity';
import { JwtAppService } from '../auth/services/jwt.service';
import { JwtService } from '@nestjs/jwt';
import { RoleChat } from '../chats/entities/role_chat.entity';
import { TypeMessage } from './entities/typeMessage.entity';

@Module({
    imports: [
        TypeOrmModule.forFeature([
            Message,
            ChatMember,
            Chat,
            User,
            RoleChat,
            TypeMessage,
        ]),
    ],
    providers: [MessageGateway, MessageService, JwtAppService, JwtService],
})
export class MessageModule {}
