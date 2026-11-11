import { Module } from '@nestjs/common';
import { ChatService } from './services/chat.service';
import { ChatsController } from './controllers/chats.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Chat } from './entities/chat.entity';
import { ChatMember } from './entities/chat_members.entity';
import { ChatGateway } from './gateways/chats.gateway';
import { UserService } from '../auth/services/user.service';
import { User } from '../auth/entities/user.entity';
import { UserProfile } from '../auth/entities/user_profile.entity';
import { JwtAppService } from '../auth/services/jwt.service';
import { JwtService } from '@nestjs/jwt';
import { ChatSeen } from './entities/chats_seen.entity';
import { Message } from '../messages/entities/message.entity';
import { RoleChat } from './entities/role_chat.entity';
import { PermissionChat } from './entities/permission_chat.entity';
import { PermissionAdmin } from './entities/permission_admin.entity';
import { ManageChatsController } from './controllers/manageChats.controller';
import { PermissionChatService } from './services/permissionChat.service';
import { InviteLinkService } from './services/inviteLink.service';
import { Link } from './entities/link.entity';
import { ChatAccessService } from './services/chat-access.service';
import { GroupRealtimeService } from './services/group-realtime.service';
import { PrivateChatService } from './services/private-chat.service';
import { RateLimitService } from 'src/common/services/rate-limit.service';
import { ChatPermissionService } from './services/chat-permission.service';
import { GroupMembersService } from './services/group-members.service';
import { GroupController } from './controllers/group.controller';
import { GroupInfoService } from './services/group-info.service';
import { GroupAvatarUploadInterceptor } from './interceptors/group-avatar-upload.interceptor';
import { GroupAvatarLimitGuard } from './guards/group-avatar-limit.guard';
import { GroupInviteLinksService } from './services/group-invite-links.service';
import { GroupInviteLinksController } from './controllers/group-invite-links.controller';
import { InviteController } from './controllers/invite.controller';

@Module({
    imports: [
        TypeOrmModule.forFeature([
            Chat,
            ChatMember,
            User,
            UserProfile,
            ChatSeen,
            Message,
            RoleChat,
            PermissionChat,
            PermissionAdmin,
            Link,
        ]),
    ],
    providers: [
        ChatService,
        PermissionChatService,
        InviteLinkService,
        ChatAccessService,
        GroupRealtimeService,
        PrivateChatService,
        ChatPermissionService,
        GroupMembersService,
        GroupInfoService,
        GroupInviteLinksService,
        GroupAvatarUploadInterceptor,
        GroupAvatarLimitGuard,
        RateLimitService,
        ChatGateway,
        UserService,
        JwtAppService,
        JwtService,
    ],
    controllers: [
        ChatsController,
        ManageChatsController,
        GroupController,
        GroupInviteLinksController,
        InviteController,
    ],
    exports: [
        ChatService,
        GroupRealtimeService,
        ChatAccessService,
        PrivateChatService,
    ],
})
export class ChatsModule {}
