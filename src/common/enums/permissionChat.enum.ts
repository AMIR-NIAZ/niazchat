/**
 * Stored permission names (`permission_chats.name`, joined to a member through
 * `permission_admin`).
 *
 * The NEW keys are the contract (`GroupPermission` in
 * `chats/utils/group-permissions.util.ts`). The legacy names are kept here
 * because existing rows still store them; they are normalized on read and are
 * rewritten to the new names on the next save.
 */
export enum PermissionChatEnum {
    // ── current keys ───────────────────────────────────────────────────────
    EDIT_GROUP_INFO = 'edit_group_info',
    MANAGE_MEMBERS = 'manage_members',
    REMOVE_MEMBERS = 'remove_members',
    BAN_USERS = 'ban_users',
    MANAGE_INVITES = 'manage_invites',
    PIN_MESSAGES = 'pin_messages',
    DELETE_OTHER_MESSAGES = 'delete_other_messages',
    MANAGE_MESSAGES = 'manage_messages',
    RESTRICT_MEMBERS = 'restrict_members',
    MANAGE_VOICE_CHATS = 'manage_voice_chats',
    MANAGE_ADMINS = 'manage_admins',
    MANAGE_PERMISSIONS = 'manage_permissions',

    // ── special wildcard (kept) ────────────────────────────────────────────
    ALL = 'all',

    // ── legacy aliases (existing data only) ────────────────────────────────
    DELETE_MESSAGE = 'delete_message',
    CHANGE_INFO_CHAT = 'change_info_chat',
    BAN_USER = 'ban_user',
    PIN_MESSAGE = 'pin_message',
}
