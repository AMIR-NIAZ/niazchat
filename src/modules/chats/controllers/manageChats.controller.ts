import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Post,
    UploadedFile,
    UseGuards,
    UseInterceptors,
    ParseIntPipe,
} from '@nestjs/common';
import { Role } from 'src/common/decorators/role.decorator';
import { RoleEnum } from 'src/common/enums/role.enum';
import { ChatService } from '../services/chat.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { ManagerChatGuard } from 'src/common/guards/restGuards/ManagerChatGuard.guard';
import { PermissionChatDto } from '../dtos/permissionChat.dto';
import { PermissionAdminChat } from 'src/common/decorators/PermissionAdminChat.decorator';
import { PermissionChatEnum } from 'src/common/enums/permissionChat.enum';
import { PermissionChatService } from '../services/permissionChat.service';
import { createLinkDto } from '../dtos/createLink.dto';
import { InviteLinkService } from '../services/inviteLink.service';
import { ChatId } from 'src/common/types/brands.type';

@Controller('chats/manage')
@UseGuards(ManagerChatGuard)
export class ManageChatsController {
    constructor(
        private readonly chatService: ChatService,
        private readonly permissionChatService: PermissionChatService,
        private readonly linkService: InviteLinkService,
    ) {}
    @Post('/:groupId/add/:userPhone')
    @Role([RoleEnum.ALL])
    @PermissionAdminChat([PermissionChatEnum.ALL])
    async addMemberByPhone(
        @Param('groupId', ParseIntPipe) groupId: ChatId,
        @Param('userPhone') userPhone: string,
    ) {
        return await this.chatService.addMemberByPhone(groupId, userPhone);
    }

    @Post('upload/avatar/:chatId')
    @Role([RoleEnum.ALL])
    @PermissionAdminChat([PermissionChatEnum.CHANGE_INFO_CHAT])
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
        @UploadedFile() file: Express.Multer.File,
        @Param('chatId', ParseIntPipe) chatId: ChatId,
    ) {
        return await this.chatService.uploadAvatar(file.path, chatId);
    }

    @Delete('delete/avatar/:chatId')
    @Role([RoleEnum.ALL])
    @PermissionAdminChat([PermissionChatEnum.CHANGE_INFO_CHAT])
    async deleteAvatar(
        @Body('avatar') avatar: string,
        @Param('chatId', ParseIntPipe) chatId: ChatId,
    ) {
        return await this.chatService.deleteAvatar(chatId, avatar);
    }

    @Post('/ban/:memberId')
    @Role([RoleEnum.ALL])
    @PermissionAdminChat([PermissionChatEnum.BAN_USER])
    async banMember(@Param('memberId', ParseIntPipe) memberId: number) {
        return await this.chatService.banMember(memberId);
    }

    @Post('/onban/:memberId')
    @Role([RoleEnum.ALL])
    @PermissionAdminChat([PermissionChatEnum.BAN_USER])
    async onBanMember(@Param('memberId', ParseIntPipe) memberId: number) {
        return await this.chatService.onBanMember(memberId);
    }

    @Get(':chatId/bans')
    @Role([RoleEnum.ALL])
    @PermissionAdminChat([PermissionChatEnum.BAN_USER])
    async getAllBanUsers(@Param('chatId', ParseIntPipe) chatId: ChatId) {
        return await this.chatService.getAllBanUser(chatId);
    }

    @Post('ban/:chatId')
    @Role([RoleEnum.ADMIN])
    async ban(@Param('chatId', ParseIntPipe) chatId: ChatId) {
        return await this.chatService.banChat(chatId);
    }

    @Post('/admin/add/:memberId')
    @Role([RoleEnum.ALL])
    async addAdmin(
        @Param('memberId', ParseIntPipe) memberId: number,
        @Body() permissions: PermissionChatDto,
    ) {
        return await this.permissionChatService.addAdmin(memberId, permissions);
    }

    @Delete('/admin/delete/:memberId')
    @Role([RoleEnum.ALL])
    async deleteAdmin(@Param('memberId', ParseIntPipe) memberId: number) {
        return await this.permissionChatService.removeAdmin(memberId);
    }

    @Post('/admin/permissions/:memberId')
    @Role([RoleEnum.ALL])
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
    async getAdminPermissions(
        @Param('memberId', ParseIntPipe) memberId: number,
    ) {
        return await this.permissionChatService.getAdminPermissions(memberId);
    }

    @Post('/:chatId/link')
    @PermissionAdminChat([PermissionChatEnum.CHANGE_INFO_CHAT])
    @Role([RoleEnum.ALL])
    async createLink(@Body() dto: createLinkDto) {
        return await this.linkService.createInviteLink(dto);
    }

    @Get('/:chatId/link')
    @Role([RoleEnum.ALL])
    async getLinkChats(@Param('chatId', ParseIntPipe) chatId: ChatId) {
        return await this.linkService.getChatInviteLinks(chatId);
    }

    @Delete('/:chatId/link/:linkId')
    @Role([RoleEnum.ALL])
    async deleteLink(@Param('linkId', ParseIntPipe) linkId: number) {
        return await this.linkService.notActiveInviteLink(linkId);
    }
}
