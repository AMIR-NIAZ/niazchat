import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Message } from './entities/message.entity';
import { MessageGateway } from './gateways/message.gateway';
import { MessageService } from './services/message.service';
import { MessageForwardService } from './services/message-forward.service';
import { ForwardRequestStore } from './services/forward-request.store';
import { ChatMember } from '../chats/entities/chat_members.entity';
import { Chat } from '../chats/entities/chat.entity';
import { User } from '../auth/entities/user.entity';
import { JwtAppService } from '../auth/services/jwt.service';
import { JwtService } from '@nestjs/jwt';
import { RoleChat } from '../chats/entities/role_chat.entity';
import { TypeMessage } from './entities/typeMessage.entity';
import { TextContentHandler } from './strategis/TextContentHandler.strategy';
import {
    CONTENT_HANDLERS,
    ContentResolverService,
} from './services/content-resolver.service';
import { ChatsModule } from '../chats/chats.module';
import { AttachmentsModule } from '../attachments/attachments.module';
import { Attachment } from '../attachments/entities/attachment.entity';

@Module({
    imports: [
        ChatsModule,
        AttachmentsModule,
        TypeOrmModule.forFeature([
            Message,
            ChatMember,
            Chat,
            User,
            RoleChat,
            TypeMessage,
            Attachment,
        ]),
    ],
    providers: [
        MessageGateway,
        MessageService,
        MessageForwardService,
        ForwardRequestStore,
        JwtAppService,
        JwtService,
        TextContentHandler,
        {
            provide: CONTENT_HANDLERS,
            useFactory: (textHandler: TextContentHandler) => [textHandler],
            inject: [TextContentHandler],
        },
        ContentResolverService,
    ],
})
export class MessageModule {}
