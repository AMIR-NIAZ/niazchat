import { SetMetadata } from '@nestjs/common';
import { PermissionChatEnum } from '../enums/permissionChat.enum';
import { RoleChatEnum } from '../enums/roleChat.enum';

export const CHAT_ACCESS_KEY = 'chat-access';

export interface ChatAccessOptions {
    /** Minimum chat role required (the caller's own role). */
    minRole: RoleChatEnum;
    /** Only meaningful for admin callers: every listed permission must be granted. */
    permissions?: PermissionChatEnum[];
}

/**
 * Route metadata consumed by `ManagerChatGuard`.
 *
 * That guard (applied class-wide on the manage controller) resolves the caller
 * as a member of the target group chat and then enforces:
 *   - the chat is a live group (banned chats / non-group chats are unusable),
 *   - the caller's membership is not the `ban` role,
 *   - the caller's role outranks `minRole`,
 *   - admin callers hold every `permissions` entry (`all` satisfies any list).
 */
export const ChatAccess = (options: ChatAccessOptions) =>
    SetMetadata(CHAT_ACCESS_KEY, options);
