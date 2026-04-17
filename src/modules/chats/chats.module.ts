import { Module } from '@nestjs/common';
import { ChatService } from './services/chat.service';
import { ChatsController } from './controllers/chats.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Chat } from './entities/chat.entity';
import { ChatMember } from './entities/chat_members.entity';
import { ChatGateway } from './gateways/chats.gateway';
import { UserService } from '../auth/services/user.service';
import { User } from '../auth/entities/user.entity';
import { JwtAppService } from '../auth/services/jwt.service';
import { JwtService } from '@nestjs/jwt';
import { ChatSeen } from './entities/chats_seen.entity';
import { Message } from '../messages/entities/message.entity';
import { RoleChat } from './entities/role_chat.entity';
import { PermissionChat } from './entities/permission_chat.entity';
import { PermissionAdmin } from './entities/permission_admin.entity';

@Module({
    imports: [
        TypeOrmModule.forFeature([
            Chat,
            ChatMember,
            User,
            ChatSeen,
            Message,
            RoleChat,
            PermissionChat,
            PermissionAdmin,
        ]),
    ],
    providers: [
        ChatService,
        ChatGateway,
        UserService,
        JwtAppService,
        JwtService,
    ],
    controllers: [ChatsController],
})
export class ChatsModule {}
