import {
    BadRequestException,
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ChatAccessOptions, CHAT_ACCESS_KEY } from 'src/common/decorators/chatAccess.decorator';
import { RoleChatEnum } from 'src/common/enums/roleChat.enum';
import { ChatId } from 'src/common/types/brands.type';
import { RequestAuth } from 'src/common/types/RequestAuth.type';
import { ChatAccessService } from 'src/modules/chats/services/chat-access.service';

/** Fallback for routes without `@ChatAccess`: chat admin with no extra gate. */
const DEFAULT_ACCESS: ChatAccessOptions = { minRole: RoleChatEnum.ADMIN };

/**
 * Class-level guard for `/chats/manage/*` (registered with `@UseGuards`).
 *
 * Resolves the chat from `:chatId`/`:groupId`, or from `:memberId` through the
 * member→chat relation (member-scoped routes), then enforces via
 * `ChatAccessService`:
 *   1. the caller is a member of THAT chat (403 otherwise),
 *   2. the chat is a usable group (type `groupe`, not platform-banned),
 *   3. the caller's membership is not the `ban` role,
 *   4. the caller's role outranks `@ChatAccess({ minRole })`,
 *   5. admin callers hold every `@ChatAccess({ permissions })` requirement;
 *      `PermissionChatEnum.ALL` on the caller satisfies any list, owners are never gated.
 *
 * Per-member/target rules (outranking, owner protection, same-chat scope) are
 * enforced in the manage services through the same `ChatAccessService`.
 */
@Injectable()
export class ManagerChatGuard implements CanActivate {
    constructor(
        private readonly reflector: Reflector,
        private readonly access: ChatAccessService,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const accessOptions: ChatAccessOptions | undefined = this.reflector.get(
            CHAT_ACCESS_KEY,
            context.getHandler(),
        );

        const request = context.switchToHttp().getRequest<RequestAuth>();
        const chatId = await this.resolveChatId(request);
        const caller = await this.access.getCallerContext(
            chatId,
            request.user.sub,
        );

        this.access.assertUsableGroup(caller);
        const options = accessOptions ?? DEFAULT_ACCESS;
        this.access.assertRole(caller, options.minRole);
        this.access.assertPermissions(caller, options.permissions ?? []);

        return true;
    }

    /** chatId from `:chatId`/`:groupId`, else from a member-scoped route. */
    private async resolveChatId(request: RequestAuth): Promise<ChatId> {
        const params = request.params;
        const chatParam = Number(params.groupId ?? params.chatId);
        if (Number.isInteger(chatParam) && chatParam > 0) {
            return chatParam as ChatId;
        }

        const memberParam = Number(params.memberId);
        if (!Number.isInteger(memberParam) || memberParam <= 0) {
            throw new BadRequestException('chat id or member id not valid');
        }

        const target = await this.access.getTargetMember(memberParam);
        return target.chat.id;
    }
}
