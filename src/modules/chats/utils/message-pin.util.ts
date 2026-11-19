import { PermissionChatEnum } from 'src/common/enums/permissionChat.enum';
import { RoleChatEnum } from 'src/common/enums/roleChat.enum';
import { TypeChatEnum } from 'src/common/enums/typeChat.enum';
import { hasPermission } from './group-permissions.util';

/**
 * The slice of the caller context the pure pin rule needs.
 *
 * Permissions come from the SAME `permission_admin` grants the group panel
 * edits (owner → admin), and the same rows are honoured for regular members:
 * a grant is an explicit capability whatever the member's role.
 */
export interface MessagePinCallerRules {
    chatType: TypeChatEnum;
    /** The group itself was banned by an administrator. */
    isChatBanned: boolean;
    roleName: RoleChatEnum | string | null | undefined;
    isManager: boolean;
    isAdmin: boolean;
    permissions: readonly PermissionChatEnum[];
}

/**
 * Who may pin/unpin messages:
 * - private chats: both participants;
 * - groups: the owner always; admins and regular members only with the
 *   explicit `pin_message` grant (or the `all` bypass);
 * - banned members and banned groups: never.
 *
 * This is intentionally the only pin authorization rule: the backend uses it
 * for both pin and unpin, and the mobile app mirrors it for menu eligibility.
 */
export function canPinMessages(caller: MessagePinCallerRules): boolean {
    if (caller.roleName === RoleChatEnum.BAN) {
        return false;
    }
    if (caller.chatType === TypeChatEnum.PRIVATE) {
        return true;
    }
    if (caller.isChatBanned) {
        return false;
    }
    if (caller.isManager) {
        return true;
    }
    return hasPermission(
        caller.isAdmin ? 'admin' : 'member',
        caller.permissions,
        'pin_messages',
    );
}
