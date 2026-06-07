import {
    Body,
    Controller,
    Param,
    ParseIntPipe,
    Post,
    Req,
} from '@nestjs/common';
import { Role } from 'src/common/decorators/role.decorator';
import { RoleEnum } from 'src/common/enums/role.enum';
import { ChatService } from '../services/chat.service';
import { createChatDto } from '../dtos/createChat.dto';
import { RequestAuth } from 'src/common/types/RequestAuth.type';
import { InviteLinkService } from '../services/inviteLink.service';
import { ChatId } from 'src/common/types/brands.type';

@Controller('chats')
export class ChatsController {
    constructor(
        private readonly chatService: ChatService,
        private readonly linkService: InviteLinkService,
    ) {}

    @Post('create')
    @Role([RoleEnum.ALL])
    async createGroup(@Body() dto: createChatDto, @Req() req: RequestAuth) {
        return await this.chatService.createGroup(dto, req.user);
    }

    @Post('/:chatId/ban')
    @Role([RoleEnum.ADMIN])
    async ban(@Param('chatId', ParseIntPipe) chatId: ChatId) {
        return await this.chatService.banChat(chatId);
    }

    @Post('/join/:code')
    @Role([RoleEnum.ALL])
    async joinToChat(@Param('code') code: string, @Req() req: RequestAuth) {
        return await this.linkService.joinByInviteCode(code, req.user.sub);
    }
}
