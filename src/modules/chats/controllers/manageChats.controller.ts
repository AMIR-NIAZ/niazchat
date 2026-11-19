import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Patch,
    Post,
    Query,
    Req,
    UploadedFile,
    UseGuards,
    UseInterceptors,
    ParseIntPipe,
    BadRequestException,
} from '@nestjs/common';
import { Role } from 'src/common/decorators/role.decorator';
import { RoleEnum } from 'src/common/enums/role.enum';
import { ChatService } from '../services/chat.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { ManagerChatGuard } from 'src/common/guards/restGuards/ManagerChatGuard.guard';
import { CreateChatTitleDto } from '../dtos/chatTitle.dto';
import { ChatAccess } from 'src/common/decorators/chatAccess.decorator';
import { PermissionChatEnum } from 'src/common/enums/permissionChat.enum';
import { RoleChatEnum } from 'src/common/enums/roleChat.enum';
import { PermissionChatDto } from '../dtos/permissionChat.dto';
import { PermissionChatService } from '../services/permissionChat.service';
import { createLinkDto } from '../dtos/createLink.dto';
import {
    GroupInviteLinksService,
    InviteLinkItem,
    InviteLinkRevokeResponse,
    InviteLinksResponse,
} from '../services/group-invite-links.service';
import {
    INVITE_EXPIRY_OPTIONS,
    INVITE_MAX_USES_OPTIONS,
} from '../utils/invite-link.util';
import { ChatId } from 'src/common/types/brands.type';
import { RequestAuth } from 'src/common/types/RequestAuth.type';
import { ChatAccessService } from '../services/chat-access.service';

/**
 * Group management surface. Class guard: `ManagerChatGuard` (member of THAT
 * group chat, chat usable, caller not banned, role/permission gates from
 * `@ChatAccess`). Per-target rules (owner protection, same-chat, outranking)
 * live in the services via `ChatAccessService`.
 */
@Controller('chats/manage')
@UseGuards(ManagerChatGuard)
export class ManageChatsController {
    constructor(
        private readonly chatService: ChatService,
        private readonly permissionChatService: PermissionChatService,
        private readonly inviteLinks: GroupInviteLinksService,
        private readonly access: ChatAccessService,
    ) {}

    // ── members ────────────────────────────────────────────────────────────

    /** Paginated + searchable member list; visible to every member (no ban role). */
    @Get(':chatId/members')
    @Role([RoleEnum.ALL])
    @ChatAccess({ minRole: RoleChatEnum.USER })
    async getChatMembers(
        @Req() request: RequestAuth,
        @Param('chatId', ParseIntPipe) chatId: ChatId,
        @Query('search') search?: string,
        @Query('limit') limit?: string,
        @Query('cursor') cursor?: string,
    ) {
        return await this.chatService.getChatMembers(chatId, request.user.sub, {
            search,
            limit: Number(limit),
            cursor: Number(cursor),
        });
    }

    // ── chat info ──────────────────────────────────────────────────────────

    @Patch(':chatId/title')
    @Role([RoleEnum.ALL])
    @ChatAccess({
        minRole: RoleChatEnum.ADMIN,
        permissions: [PermissionChatEnum.EDIT_GROUP_INFO],
    })
    async updateTitle(
        @Req() request: RequestAuth,
        @Param('chatId', ParseIntPipe) chatId: ChatId,
        @Body() dto: CreateChatTitleDto,
    ) {
        return await this.chatService.updateTitle(
            chatId,
            request.user.sub,
            dto.title,
        );
    }

    @Post('upload/avatar/:chatId')
    @Role([RoleEnum.ALL])
    @ChatAccess({
        minRole: RoleChatEnum.ADMIN,
        permissions: [PermissionChatEnum.EDIT_GROUP_INFO],
    })
    @UseInterceptors(
        FileInterceptor('avatar', {
            storage: diskStorage({
                destination: './uploads/avatars',
                filename: (req, file, cb) => {
                    const uniqueName =
                        Date.now() + '-' + Math.round(Math.random() * 1e9);
                    cb(null, uniqueName + extname(file.originalname));
                },
            }),
        }),
    )
    async uploadAvatar(
        @Req() request: RequestAuth,
        @UploadedFile() file: Express.Multer.File,
        @Param('chatId', ParseIntPipe) chatId: ChatId,
    ) {
        return await this.chatService.uploadAvatar(
            file.path,
            chatId,
            request.user.sub,
        );
    }

    @Delete('delete/avatar/:chatId')
    @Role([RoleEnum.ALL])
    @ChatAccess({
        minRole: RoleChatEnum.ADMIN,
        permissions: [PermissionChatEnum.EDIT_GROUP_INFO],
    })
    async deleteAvatar(
        @Req() request: RequestAuth,
        @Body('avatar') avatar: string,
        @Param('chatId', ParseIntPipe) chatId: ChatId,
    ) {
        return await this.chatService.deleteAvatar(
            chatId,
            avatar,
            request.user.sub,
        );
    }

    // ── members mutation ───────────────────────────────────────────────────

    /**
     * Add by phone. Owners/admins need `manage_members`; a regular member is
     * allowed when the group's member policy enables `add_members`. The
     * service performs the whole authorization, so no route-level role gate
     * (which would make the member switch unreachable).
     */
    @Post('/:groupId/add/:userPhone')
    @Role([RoleEnum.ALL])
    async addMemberByPhone(
        @Req() request: RequestAuth,
        @Param('groupId', ParseIntPipe) groupId: ChatId,
        @Param('userPhone') userPhone: string,
    ) {
        return await this.chatService.addMemberByPhone(
            groupId,
            userPhone,
            request.user.sub,
        );
    }

    /** Kick: remove someone else; a leaving member uses `/leave`. */
    @Delete(':chatId/members/:memberId')
    @Role([RoleEnum.ALL])
    @ChatAccess({
        minRole: RoleChatEnum.ADMIN,
        permissions: [PermissionChatEnum.REMOVE_MEMBERS],
    })
    async kickMember(
        @Req() request: RequestAuth,
        @Param('chatId', ParseIntPipe) chatId: ChatId,
        @Param('memberId', ParseIntPipe) memberId: number,
    ) {
        return await this.chatService.kickMember(
            chatId,
            memberId,
            request.user.sub,
        );
    }

    /** Leave the group (owner rejected server-side: no ownership transfer). */
    @Post(':chatId/leave')
    @Role([RoleEnum.ALL])
    @ChatAccess({ minRole: RoleChatEnum.USER })
    async leaveChat(
        @Req() request: RequestAuth,
        @Param('chatId', ParseIntPipe) chatId: ChatId,
    ) {
        return await this.chatService.leaveChat(chatId, request.user.sub);
    }

    // ── bans ───────────────────────────────────────────────────────────────

    /** Owner-only: `manager` is the group owner; chat `admin` cannot ban. */
    @Post('/ban/:memberId')
    @Role([RoleEnum.ALL])
    @ChatAccess({
        minRole: RoleChatEnum.ADMIN,
        permissions: [PermissionChatEnum.BAN_USERS],
    })
    async banMember(
        @Req() request: RequestAuth,
        @Param('memberId', ParseIntPipe) memberId: number,
    ) {
        return await this.chatService.banMember(memberId, request.user.sub);
    }

    /** Unban: owner, or an admin holding `ban_user`/`all`. */
    @Post('/onban/:memberId')
    @Role([RoleEnum.ALL])
    @ChatAccess({
        minRole: RoleChatEnum.ADMIN,
        permissions: [PermissionChatEnum.BAN_USERS],
    })
    async onBanMember(
        @Req() request: RequestAuth,
        @Param('memberId', ParseIntPipe) memberId: number,
    ) {
        return await this.chatService.onBanMember(memberId, request.user.sub);
    }

    @Get(':chatId/bans')
    @Role([RoleEnum.ALL])
    @ChatAccess({
        minRole: RoleChatEnum.ADMIN,
        permissions: [PermissionChatEnum.BAN_USERS],
    })
    async getAllBanUsers(@Param('chatId', ParseIntPipe) chatId: ChatId) {
        return await this.chatService.getAllBanUser(chatId);
    }

    /** Platform-level chat ban (kept for API parity; not exposed in the app). */
    @Post(':chatId/ban-chat')
    @Role([RoleEnum.ADMIN])
    @ChatAccess({ minRole: RoleChatEnum.ADMIN })
    async ban(@Param('chatId', ParseIntPipe) chatId: ChatId) {
        return await this.chatService.banChat(chatId);
    }

    // ── admins & permissions (manage_admins / manage_permissions) ──────────

    @Post('/admin/add/:memberId')
    @Role([RoleEnum.ALL])
    @ChatAccess({
        minRole: RoleChatEnum.ADMIN,
        permissions: [PermissionChatEnum.MANAGE_ADMINS],
    })
    async addAdmin(
        @Req() request: RequestAuth,
        @Param('memberId', ParseIntPipe) memberId: number,
        @Body() permissions: PermissionChatDto,
    ) {
        return await this.permissionChatService.addAdmin(
            await this.chatIdOf(memberId),
            memberId,
            request.user.sub,
            permissions,
        );
    }

    @Delete('/admin/delete/:memberId')
    @Role([RoleEnum.ALL])
    @ChatAccess({
        minRole: RoleChatEnum.ADMIN,
        permissions: [PermissionChatEnum.MANAGE_ADMINS],
    })
    async deleteAdmin(
        @Req() request: RequestAuth,
        @Param('memberId', ParseIntPipe) memberId: number,
    ) {
        return await this.permissionChatService.removeAdmin(
            await this.chatIdOf(memberId),
            memberId,
            request.user.sub,
        );
    }

    @Post('/admin/permissions/:memberId')
    @Role([RoleEnum.ALL])
    @ChatAccess({
        minRole: RoleChatEnum.ADMIN,
        permissions: [PermissionChatEnum.MANAGE_PERMISSIONS],
    })
    async addPermissionforAdmin(
        @Req() request: RequestAuth,
        @Param('memberId', ParseIntPipe) memberId: number,
        @Body() permissionDto: PermissionChatDto,
    ) {
        return await this.permissionChatService.addPermissionforAdmin(
            await this.chatIdOf(memberId),
            memberId,
            request.user.sub,
            permissionDto,
        );
    }

    @Delete('/admin/permissions/:memberId')
    @Role([RoleEnum.ALL])
    @ChatAccess({
        minRole: RoleChatEnum.ADMIN,
        permissions: [PermissionChatEnum.MANAGE_PERMISSIONS],
    })
    async deletePermissionforAdmin(
        @Req() request: RequestAuth,
        @Param('memberId', ParseIntPipe) memberId: number,
        @Body() permissionDto: PermissionChatDto,
    ) {
        return await this.permissionChatService.deletePermissionforAdmin(
            await this.chatIdOf(memberId),
            memberId,
            request.user.sub,
            permissionDto,
        );
    }

    @Get('/admin/permissions/:memberId')
    @Role([RoleEnum.ALL])
    @ChatAccess({
        minRole: RoleChatEnum.ADMIN,
        permissions: [PermissionChatEnum.MANAGE_PERMISSIONS],
    })
    async getAdminPermissions(
        @Req() request: RequestAuth,
        @Param('memberId', ParseIntPipe) memberId: number,
    ) {
        return await this.permissionChatService.getAdminPermissions(
            await this.chatIdOf(memberId),
            memberId,
            request.user.sub,
        );
    }

    private async chatIdOf(memberId: number): Promise<ChatId> {
        const target = await this.access.getTargetMember(memberId);
        return target.chat.id;
    }

    // ── invite links (any admin) ───────────────────────────────────────────

    /**
     * Legacy create route, kept for existing clients/scripts. Delegates to the
     * clean service; the legacy `usageLimit`/`expiresAt` body fields are mapped
     * onto the new allowlists (anything else is still a 400).
     */
    @Post('/:chatId/link')
    @Role([RoleEnum.ALL])
    @ChatAccess({
        minRole: RoleChatEnum.ADMIN,
        permissions: [PermissionChatEnum.MANAGE_INVITES],
    })
    async createLink(
        @Req() request: RequestAuth,
        @Param('chatId', ParseIntPipe) chatId: ChatId,
        @Body() dto: createLinkDto,
    ): Promise<InviteLinkItem> {
        if (Number(dto.chatId) !== chatId) {
            throw new BadRequestException(
                'body chatId must match the URL chatId',
            );
        }

        const requestedMaxUses = Number(dto.usageLimit ?? 0);
        const maxUses = requestedMaxUses <= 0 ? null : requestedMaxUses;
        if (
            maxUses !== null &&
            !(INVITE_MAX_USES_OPTIONS as readonly number[]).includes(maxUses)
        ) {
            throw new BadRequestException('invalid usage limit');
        }

        let expiresInSeconds: number | null = null;
        if (dto.expiresAt !== undefined) {
            const seconds = Math.round(
                (new Date(dto.expiresAt).getTime() - Date.now()) / 1000,
            );
            if (
                !(INVITE_EXPIRY_OPTIONS as readonly number[]).includes(seconds)
            ) {
                throw new BadRequestException('invalid expiry');
            }
            expiresInSeconds = seconds;
        }

        return await this.inviteLinks.createLink(chatId, request.user.sub, {
            expiresInSeconds,
            maxUses,
        });
    }

    @Get('/:chatId/link')
    @Role([RoleEnum.ALL])
    @ChatAccess({
        minRole: RoleChatEnum.ADMIN,
        permissions: [PermissionChatEnum.MANAGE_INVITES],
    })
    async getLinkChats(
        @Req() request: RequestAuth,
        @Param('chatId', ParseIntPipe) chatId: ChatId,
    ): Promise<InviteLinksResponse> {
        return await this.inviteLinks.listLinks(chatId, request.user.sub);
    }

    @Delete('/:chatId/link/:linkId')
    @Role([RoleEnum.ALL])
    @ChatAccess({
        minRole: RoleChatEnum.ADMIN,
        permissions: [PermissionChatEnum.MANAGE_INVITES],
    })
    async deleteLink(
        @Req() request: RequestAuth,
        @Param('chatId', ParseIntPipe) chatId: ChatId,
        @Param('linkId', ParseIntPipe) linkId: number,
    ): Promise<InviteLinkRevokeResponse> {
        return await this.inviteLinks.revokeLink(
            chatId,
            linkId,
            request.user.sub,
        );
    }
}
