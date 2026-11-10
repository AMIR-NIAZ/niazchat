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
import { GroupRealtimeService } from '../services/group-realtime.service';
import { PrivateChatService } from '../services/private-chat.service';
import { CreatePrivateChatDto } from '../dtos/createPrivateChat.dto';

@Controller('chats')
export class ChatsController {
    constructor(
        private readonly chatService: ChatService,
        private readonly linkService: InviteLinkService,
        private readonly groupRealtime: GroupRealtimeService,
        private readonly privateChatService: PrivateChatService,
    ) {}

    @Post('create')
    @Role([RoleEnum.ALL])
    async createGroup(@Body() dto: createChatDto, @Req() req: RequestAuth) {
        return await this.chatService.createGroup(dto, req.user);
    }

    /**
     * Find or create the ONE private chat of the caller and `userId`.
     * Idempotent and symmetric; a newly created empty chat stays hidden from
     * both chat lists until its first message.
     */
    @Post('private')
    @Role([RoleEnum.ALL])
    async createPrivateChat(
        @Body() dto: CreatePrivateChatDto,
        @Req() req: RequestAuth,
    ) {
        return await this.privateChatService.create(req.user, dto.userId);
    }

    @Post('/:chatId/ban')
    @Role([RoleEnum.ADMIN])
    async ban(@Param('chatId', ParseIntPipe) chatId: ChatId) {
        return await this.chatService.banChat(chatId);
    }

    @Post('/join/:code')
    @Role([RoleEnum.ALL])
    async joinToChat(@Param('code') code: string, @Req() req: RequestAuth) {
        const chat = await this.linkService.joinByInviteCode(
            code,
            req.user.sub,
        );
        this.groupRealtime.groupAdded(chat.id, req.user.sub);
        this.groupRealtime.groupChanged(chat.id, 'member_joined');
        await this.chatService.notifyMembersCount(chat.id);
        return { chatId: chat.id, title: chat.title };
    }
}
