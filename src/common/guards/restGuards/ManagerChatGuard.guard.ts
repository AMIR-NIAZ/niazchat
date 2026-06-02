import {
    BadRequestException,
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { PERMISSION_CHAT_KEY } from 'src/common/decorators/PermissionAdminChat.decorator';
import { PermissionChatEnum } from 'src/common/enums/permissionChat.enum';
import { RoleChatEnum } from 'src/common/enums/roleChat.enum';
import { RequestAuth } from 'src/common/types/RequestAuth.type';
import { ChatMember } from 'src/modules/chats/entities/chat_members.entity';
import { PermissionAdmin } from 'src/modules/chats/entities/permission_admin.entity';
import { RoleChat } from 'src/modules/chats/entities/role_chat.entity';
import { Repository } from 'typeorm';

@Injectable()
export class ManagerChatGuard implements CanActivate {
    constructor(
        private readonly reflector: Reflector,
        @InjectRepository(ChatMember)
        private readonly memberRepository: Repository<ChatMember>,
        @InjectRepository(RoleChat)
        private readonly roleChatRepository: Repository<RoleChat>,
        @InjectRepository(PermissionAdmin)
        private readonly permissionAdminRepository: Repository<PermissionAdmin>,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const Http = context.switchToHttp();
        const request = Http.getRequest<RequestAuth>();

        const member = await this.getMember(request);

        const hasManage = await this.isManageChat(member);

        if (hasManage) {
            return true;
        } else {
            const hasAdmin = await this.isAdminChat(member);
            if (!hasAdmin) throw new ForbiddenException();

            const accessPermissions: PermissionChatEnum[] = this.reflector.get(
                PERMISSION_CHAT_KEY,
                context.getHandler(),
            );

            if (!accessPermissions) throw new ForbiddenException();
            if (accessPermissions.includes(PermissionChatEnum.ALL)) return true;

            const adminPermissions = await this.permissionAdminRepository.find({
                where: {
                    member: { id: member.id },
                },
            });

            const hasAdminAccess = accessPermissions.every((per: string) =>
                adminPermissions.some(
                    (adminper) => adminper.permission.name === per,
                ),
            );
            if (hasAdminAccess) return hasAdminAccess;
        }

        throw new ForbiddenException();
    }

    private async isAdminChat(member: ChatMember) {
        const AdminRole = await this.roleChatRepository.findOne({
            where: { name: RoleChatEnum.ADMIN },
        });
        if (!AdminRole) throw new NotFoundException('manage role not found');

        return member.role.id === AdminRole.id;
    }

    private async isManageChat(member: ChatMember) {
        const manageRole = await this.roleChatRepository.findOne({
            where: { name: RoleChatEnum.MANAGER },
        });
        if (!manageRole) throw new NotFoundException('manage role not found');

        return member.role.id === manageRole.id;
    }

    private async getMember(request: RequestAuth) {
        const chatId: number = +request.params.chatId;
        const memberId: number = +request.params.memberId;
        const userPayloade = request.user;

        let member: ChatMember | null;
        if (chatId) {
            member = await this.memberRepository.findOne({
                where: {
                    user: { id: userPayloade.sub },
                    chat: { id: chatId },
                },
            });
            if (!member) throw new ForbiddenException();
        } else if (memberId) {
            const memberChat = await this.memberRepository.findOne({
                where: {
                    id: memberId,
                },
            });
            if (!memberChat) throw new ForbiddenException();

            member = await this.memberRepository.findOne({
                where: {
                    user: { id: userPayloade.sub },
                    chat: { id: memberChat.chat.id },
                },
            });
            if (!member) throw new ForbiddenException();
        } else {
            throw new BadRequestException('chat id or member id not valid');
        }

        return member;
    }
}
