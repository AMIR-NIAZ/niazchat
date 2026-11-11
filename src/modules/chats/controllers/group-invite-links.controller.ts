import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    ParseIntPipe,
    Post,
    Req,
} from '@nestjs/common';
import { Role } from 'src/common/decorators/role.decorator';
import { RoleEnum } from 'src/common/enums/role.enum';
import { ChatId } from 'src/common/types/brands.type';
import { RequestAuth } from 'src/common/types/RequestAuth.type';
import { CreateInviteLinkDto } from '../dtos/createInviteLink.dto';
import {
    GroupInviteLinksService,
    InviteLinkItem,
    InviteLinkRevokeResponse,
    InviteLinksResponse,
} from '../services/group-invite-links.service';

/**
 * Owner/admin invite-link management. Authorization is enforced in the
 * service against the clean `ChatPermissionService` (never the legacy guard).
 */
@Controller('chats')
export class GroupInviteLinksController {
    constructor(private readonly inviteLinks: GroupInviteLinksService) {}

    @Get(':chatId/invite-links')
    @Role([RoleEnum.ALL])
    listInviteLinks(
        @Req() request: RequestAuth,
        @Param('chatId', ParseIntPipe) chatId: ChatId,
    ): Promise<InviteLinksResponse> {
        return this.inviteLinks.listLinks(chatId, request.user.sub);
    }

    @Post(':chatId/invite-links')
    @Role([RoleEnum.ALL])
    createInviteLink(
        @Req() request: RequestAuth,
        @Param('chatId', ParseIntPipe) chatId: ChatId,
        @Body() dto: CreateInviteLinkDto,
    ): Promise<InviteLinkItem> {
        return this.inviteLinks.createLink(chatId, request.user.sub, {
            expiresInSeconds: dto.expiresInSeconds ?? null,
            maxUses: dto.maxUses ?? null,
        });
    }

    @Delete(':chatId/invite-links/:linkId')
    @Role([RoleEnum.ALL])
    revokeInviteLink(
        @Req() request: RequestAuth,
        @Param('chatId', ParseIntPipe) chatId: ChatId,
        @Param('linkId', ParseIntPipe) linkId: number,
    ): Promise<InviteLinkRevokeResponse> {
        return this.inviteLinks.revokeLink(
            chatId,
            linkId,
            request.user.sub,
        );
    }
}
