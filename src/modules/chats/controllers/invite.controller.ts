import { Controller, Get, Param, Post, Req } from '@nestjs/common';
import { Role } from 'src/common/decorators/role.decorator';
import { RoleEnum } from 'src/common/enums/role.enum';
import { RequestAuth } from 'src/common/types/RequestAuth.type';
import {
    GroupInviteLinksService,
    InvitePreviewResponse,
    JoinInviteResponse,
} from '../services/group-invite-links.service';

/**
 * Join side of invite links. Every invalid state answers the SAME 404 so the
 * app cannot distinguish unknown/expired/used-up/revoked codes (a banned
 * caller is the only explicit 403).
 */
@Controller('invites')
export class InviteController {
    constructor(private readonly inviteLinks: GroupInviteLinksService) {}

    @Get(':code')
    @Role([RoleEnum.ALL])
    preview(
        @Req() request: RequestAuth,
        @Param('code') code: string,
    ): Promise<InvitePreviewResponse> {
        return this.inviteLinks.preview(code, request.user.sub);
    }

    @Post(':code/join')
    @Role([RoleEnum.ALL])
    join(
        @Req() request: RequestAuth,
        @Param('code') code: string,
    ): Promise<JoinInviteResponse> {
        return this.inviteLinks.joinByCode(code, request.user.sub);
    }
}
