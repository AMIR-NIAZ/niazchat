import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Message } from './entities/message.entity';
import { MessageGateway } from './gateways/message.gateway';
import { MessageService } from './services/message.service';
import { ChatMember } from '../chats/entities/chat_members.entity';
import { Chat } from '../chats/entities/chat.entity';
import { User } from '../auth/entities/user.entity';

@Module({
    imports: [TypeOrmModule.forFeature([Message, ChatMember, Chat, User])],
    controllers: [],
    providers: [MessageGateway, MessageService],
})
export class MessageModule {}
