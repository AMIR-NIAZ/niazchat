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
import { TextContentHandler } from './strategis/TextContentHandler.strategy';
import { FileContentHandler } from './strategis/FileContentHandler.strategy';
import { CONTENT_HANDLERS, ContentResolverService } from './services/content-resolver.service';

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
    providers: [
        MessageGateway,
        MessageService,
        JwtAppService,
        JwtService,
        TextContentHandler,
        FileContentHandler,
        {
            provide: CONTENT_HANDLERS,
            useFactory: (
                textHandler: TextContentHandler,
                fileHandler: FileContentHandler,
            ) => [textHandler, fileHandler],
            inject: [TextContentHandler, FileContentHandler],
        },
        ContentResolverService,
    ],
})
export class MessageModule { }
