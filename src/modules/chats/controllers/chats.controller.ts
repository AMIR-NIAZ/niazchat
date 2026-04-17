import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Post,
    Put,
    Req,
    UploadedFile,
    UseGuards,
    UseInterceptors,
    ParseIntPipe,
} from '@nestjs/common';
import { Role } from 'src/common/decorators/role.decorator';
import { RoleEnum } from 'src/common/enums/role.enum';
import { ChatService } from '../services/chat.service';
import { createChatDto } from '../dtos/createChat.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { RequestAuth } from 'src/common/types/RequestAuth.type';
import { ManagerChatGuard } from 'src/common/guards/restGuards/ManagerChatGuard.guard';
import { PermissionChatDto } from '../dtos/permissionChat.dto';

@Controller('chats')
export class ChatsController {
    constructor(private readonly chatService: ChatService) {}

    @Post('create')
    @Role([RoleEnum.ALL])
    async createGroup(@Body() dto: createChatDto, @Req() req: RequestAuth) {
        return await this.chatService.createGroup(dto, req.user);
    }

    @Post('/chats/:groupId/add/:userPhone')
    @Role([RoleEnum.ALL])
    @UseGuards(ManagerChatGuard)
    async addMemberByPhone(
        @Param('groupId', ParseIntPipe) groupId: number,
        @Param('userPhone') userPhone: string,
    ) {
        return await this.chatService.addMemberByPhone(groupId, userPhone);
    }

    @Put('upload/avatar/:chatId')
    @Role([RoleEnum.ALL])
    @UseGuards(ManagerChatGuard)
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
        @Req() req: RequestAuth,
        @Param('chatId', ParseIntPipe) chatId: number,
    ) {
        return await this.chatService.uploadAvatar(file.path, chatId);
    }

    @Delete('delete/avatar/:chatId')
    @Role([RoleEnum.ALL])
    @UseGuards(ManagerChatGuard)
    async deleteAvatar(
        @Body('avatar') avatar: string,
        @Param('chatId', ParseIntPipe) chatId: number,
    ) {
        return await this.chatService.deleteAvatar(chatId, avatar);
    }

    @Post('/:chatId/user/:userId')
    @Role([RoleEnum.ALL])
    @UseGuards(ManagerChatGuard)
    async banMember(
        @Param('chatId', ParseIntPipe) chatId: number,
        @Param('userId', ParseIntPipe) userId: number,
    ) {
        return await this.chatService.banMember(chatId, userId);
    }

    @Get(':chatId/bans')
    @Role([RoleEnum.ALL])
    @UseGuards(ManagerChatGuard)
    async getAllBanUsers(@Param('chatId', ParseIntPipe) chatId: number) {
        return await this.chatService.getAllBanUser(chatId);
    }

    @Post('ban/:chatId')
    @Role([RoleEnum.ADMIN])
    @UseGuards(ManagerChatGuard)
    async ban(@Param('chatId', ParseIntPipe) chatId: number) {
        return await this.chatService.banChat(chatId);
    }

    @Post('/admin/add/:memberId')
    @Role([RoleEnum.ALL])
    @UseGuards(ManagerChatGuard)
    async addAdmin(
        @Param('memberId', ParseIntPipe) memberId: number,
        @Body() permissions: PermissionChatDto,
    ) {
        return await this.chatService.addAdmin(memberId, permissions);
    }

    @Delete('/admin/delete/:memberId')
    @Role([RoleEnum.ALL])
    @UseGuards(ManagerChatGuard)
    async deleteAdmin(@Param('memberId', ParseIntPipe) memberId: number) {
        return await this.chatService.removeAdmin(memberId);
    }

    @Post('/admin/permission/:memberId')
    @Role([RoleEnum.ALL])
    @UseGuards(ManagerChatGuard)
    async addPermissionforAdmin(
        @Param('memberId', ParseIntPipe) memberId: number,
        @Body() permissionDto: PermissionChatDto,
    ) {
        return await this.chatService.addPermissionforAdmin(
            memberId,
            permissionDto,
        );
    }

    @Delete('/admin/permission/:memberId')
    @Role([RoleEnum.ALL])
    @UseGuards(ManagerChatGuard)
    async deletePermissionforAdmin(
        @Param('memberId', ParseIntPipe) memberId: number,
        @Body() permissionDto: PermissionChatDto,
    ) {
        return await this.chatService.deletePermissionforAdmin(
            memberId,
            permissionDto,
        );
    }

    @Get('/admin/permission/:memberId')
    @Role([RoleEnum.ALL])
    @UseGuards(ManagerChatGuard)
    async getAdminPermissions(
        @Param('memberId', ParseIntPipe) memberId: number,
    ) {
        return await this.chatService.getAdminPermissions(memberId);
    }
}
