import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { RequestAuth } from 'src/common/types/RequestAuth.type';
import { VisibilityService } from '../visibility.service';

/**
 * Guards every group READ endpoint (`GET /chats/:chatId/group`, members,
 * banned list, member permissions, ...). A caller holding the `ban` role in
 * that chat gets the shared 403 (`You can't access this group`) before any
 * service can serialize the group's profile data.
 */
@Injectable()
export class GroupVisibilityGuard implements CanActivate {
    constructor(private readonly visibility: VisibilityService) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest<RequestAuth>();
        const viewerId = request.user?.sub;
        const chatId = Number(request.params.chatId);
        if (
            viewerId === undefined ||
            !Number.isInteger(chatId) ||
            chatId <= 0
        ) {
            return true;
        }
        await this.visibility.assertCanViewGroup(Number(viewerId), chatId);
        return true;
    }
}
