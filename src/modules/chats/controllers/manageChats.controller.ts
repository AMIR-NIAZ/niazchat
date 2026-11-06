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
import { InviteLinkService } from '../services/inviteLink.service';
import { ChatId } from 'src/common/types/brands.type';
import { RequestAuth } from 'src/common/types/RequestAuth.type';

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
        private readonly linkService: InviteLinkService,
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
        permissions: [PermissionChatEnum.CHANGE_INFO_CHAT],
    })
    async updateTitle(
        @Req() request: RequestAuth,
        @Param('chatId', ParseIntPipe) chatId: ChatId,
        @Body() dto: CreateChatTitleDto,
    ) {
        return await this.chatService.updateTitle(chatId, request.user.sub, dto.title);
    }

    @Post('upload/avatar/:chatId')
    @Role([RoleEnum.ALL])
    @ChatAccess({
        minRole: RoleChatEnum.ADMIN,
        permissions: [PermissionChatEnum.CHANGE_INFO_CHAT],
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
        return await this.chatService.uploadAvatar(file.path, chatId, request.user.sub);
    }

    @Delete('delete/avatar/:chatId')
    @Role([RoleEnum.ALL])
    @ChatAccess({
        minRole: RoleChatEnum.ADMIN,
        permissions: [PermissionChatEnum.CHANGE_INFO_CHAT],
    })
    async deleteAvatar(
        @Req() request: RequestAuth,
        @Body('avatar') avatar: string,
        @Param('chatId', ParseIntPipe) chatId: ChatId,
    ) {
        return await this.chatService.deleteAvatar(chatId, avatar, request.user.sub);
    }

    // ── members mutation ───────────────────────────────────────────────────

    /** Add by phone — any admin may (lookup by contact). */
    @Post('/:groupId/add/:userPhone')
    @Role([RoleEnum.ALL])
    @ChatAccess({ minRole: RoleChatEnum.ADMIN })
    async addMemberByPhone(
        @Param('groupId', ParseIntPipe) groupId: ChatId,
        @Param('userPhone') userPhone: string,
    ) {
        return await this.chatService.addMemberByPhone(groupId, userPhone);
    }

    /** Kick: remove someone else; a leaving member uses `/leave`. */
    @Delete(':chatId/members/:memberId')
    @Role([RoleEnum.ALL])
    @ChatAccess({
        minRole: RoleChatEnum.ADMIN,
        permissions: [PermissionChatEnum.BAN_USER],
    })
    async kickMember(
        @Req() request: RequestAuth,
        @Param('chatId', ParseIntPipe) chatId: ChatId,
        @Param('memberId', ParseIntPipe) memberId: number,
    ) {
        return await this.chatService.kickMember(chatId, memberId, request.user.sub);
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

    @Post('/ban/:memberId')
    @Role([RoleEnum.ALL])
    @ChatAccess({
        minRole: RoleChatEnum.ADMIN,
        permissions: [PermissionChatEnum.BAN_USER],
    })
    async banMember(
        @Req() request: RequestAuth,
        @Param('memberId', ParseIntPipe) memberId: number,
    ) {
        return await this.chatService.banMember(memberId, request.user.sub);
    }

    @Post('/onban/:memberId')
    @Role([RoleEnum.ALL])
    @ChatAccess({
        minRole: RoleChatEnum.ADMIN,
        permissions: [PermissionChatEnum.BAN_USER],
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
        permissions: [PermissionChatEnum.BAN_USER],
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

    // ── admins & permissions (owner only) ─────────────────────────────────

    @Post('/admin/add/:memberId')
    @Role([RoleEnum.ALL])
    @ChatAccess({ minRole: RoleChatEnum.MANAGER })
    async addAdmin(
        @Param('memberId', ParseIntPipe) memberId: number,
        @Body() permissions: PermissionChatDto,
    ) {
        return await this.permissionChatService.addAdmin(memberId, permissions);
    }

    @Delete('/admin/delete/:memberId')
    @Role([RoleEnum.ALL])
    @ChatAccess({ minRole: RoleChatEnum.MANAGER })
    async deleteAdmin(@Param('memberId', ParseIntPipe) memberId: number) {
        return await this.permissionChatService.removeAdmin(memberId);
    }

    @Post('/admin/permissions/:memberId')
    @Role([RoleEnum.ALL])
    @ChatAccess({ minRole: RoleChatEnum.MANAGER })
    async addPermissionforAdmin(
        @Param('memberId', ParseIntPipe) memberId: number,
        @Body() permissionDto: PermissionChatDto,
    ) {
        return await this.permissionChatService.addPermissionforAdmin(
            memberId,
            permissionDto,
        );
    }

    @Delete('/admin/permissions/:memberId')
    @Role([RoleEnum.ALL])
    @ChatAccess({ minRole: RoleChatEnum.MANAGER })
    async deletePermissionforAdmin(
        @Param('memberId', ParseIntPipe) memberId: number,
        @Body() permissionDto: PermissionChatDto,
    ) {
        return await this.permissionChatService.deletePermissionforAdmin(
            memberId,
            permissionDto,
        );
    }

    @Get('/admin/permissions/:memberId')
    @Role([RoleEnum.ALL])
    @ChatAccess({ minRole: RoleChatEnum.MANAGER })
    async getAdminPermissions(
        @Param('memberId', ParseIntPipe) memberId: number,
    ) {
        return await this.permissionChatService.getAdminPermissions(memberId);
    }

    // ── invite links (any admin) ───────────────────────────────────────────

    @Post('/:chatId/link')
    @Role([RoleEnum.ALL])
    @ChatAccess({ minRole: RoleChatEnum.ADMIN })
    async createLink(
        @Param('chatId', ParseIntPipe) chatId: ChatId,
        @Body() dto: createLinkDto,
    ) {
        if (Number(dto.chatId) !== chatId) {
            throw new BadRequestException(
                'body chatId must match the URL chatId',
            );
        }
        return await this.linkService.createInviteLink(dto);
    }

    @Get('/:chatId/link')
    @Role([RoleEnum.ALL])
    @ChatAccess({ minRole: RoleChatEnum.ADMIN })
    async getLinkChats(@Param('chatId', ParseIntPipe) chatId: ChatId) {
        return await this.linkService.getChatInviteLinks(chatId);
    }

    @Delete('/:chatId/link/:linkId')
    @Role([RoleEnum.ALL])
    @ChatAccess({ minRole: RoleChatEnum.ADMIN })
    async deleteLink(
        @Param('chatId', ParseIntPipe) chatId: ChatId,
        @Param('linkId', ParseIntPipe) linkId: number,
    ) {
        return await this.linkService.notActiveInviteLink(linkId, chatId);
    }
}
