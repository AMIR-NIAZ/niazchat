import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    Logger,
    OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { PermissionChatEnum } from 'src/common/enums/permissionChat.enum';
import { RoleChatEnum } from 'src/common/enums/roleChat.enum';
import { TypeChatEnum } from 'src/common/enums/typeChat.enum';
import { ChatId, UserId } from 'src/common/types/brands.type';
import { Chat } from '../entities/chat.entity';
import { ChatMember } from '../entities/chat_members.entity';
import { PermissionAdmin } from '../entities/permission_admin.entity';
import type { GroupCallerRules, GroupRole } from '../utils/group-members.util';
import { roleRank, toGroupRole } from '../utils/group-members.util';
import {
    GROUP_PERMISSIONS,
    hasPermission,
    LEGACY_PERMISSION_ALIASES,
    normalizePermissions,
} from '../utils/group-permissions.util';
import type { GroupPermission } from '../utils/group-permissions.util';
import {
    normalizeMemberPermissions,
    type MemberPermission,
    type MemberPermissionsConfig,
} from '../utils/member-permissions.util';
import { MemberPermissionResolverService } from './member-permission-resolver.service';

/**
 * Caller authorization context for the group panel.
 *
 * Duplicate `(chatId, userId)` rows exist in real data, so the caller's role is
 * the highest-ranking row and permissions are the union over every row. Banned
 * callers are rejected here; the panel service still re-checks the group type
 * and `isBan` for every operation.
 */
export interface ChatCallerContext {
    chat: Chat;
    /** Canonical (highest-ranking, then oldest) caller row. */
    member: ChatMember;
    /** Every `chat_members.id` belonging to the caller in this chat. */
    memberIds: number[];
    roleName: RoleChatEnum;
    role: GroupRole;
    permissions: PermissionChatEnum[];
    isOwner: boolean;
    isAdmin: boolean;
    /**
     * Group defaults with this member's overrides applied. Owners/admins keep
     * full access at the enforcement sites; regular members are gated by this
     * resolved config.
     */
    effectiveMemberPermissions: MemberPermissionsConfig;
}

/**
 * Resolved member policy of a caller. Falls back to the group config for
 * hand-built contexts (tests/legacy call sites); production contexts always
 * carry the resolver output.
 */
export function callerMemberPermissions(caller: {
    chat: Pick<Chat, 'memberPermissions'>;
    effectiveMemberPermissions?: MemberPermissionsConfig;
}): MemberPermissionsConfig {
    return (
        caller.effectiveMemberPermissions ??
        memberPermissionsConfigOf(caller.chat)
    );
}

/** Caller role + normalized permissions for the pure permission helpers. */
function roleOf(caller: GroupCallerRules): GroupRole {
    if (caller.isOwner) return 'owner';
    return caller.isAdmin ? 'admin' : 'member';
}

export const PERMISSION_FORBIDDEN_MESSAGE =
    "You don't have permission to do this";

/** Throws the shared 403 unless the caller holds `key` (owner always does). */
export function requirePermission(
    caller: GroupCallerRules,
    key: GroupPermission,
): void {
    if (!hasPermission(roleOf(caller), caller.permissions, key)) {
        throw new ForbiddenException(PERMISSION_FORBIDDEN_MESSAGE);
    }
}

/** Group-info editing capability (`edit_group_info`). */
export function canEditInfo(caller: GroupCallerRules): boolean {
    return hasPermission(roleOf(caller), caller.permissions, 'edit_group_info');
}

/** Invite-link management capability (`manage_invites`). */
export function canManageInviteLinks(caller: GroupCallerRules): boolean {
    return hasPermission(roleOf(caller), caller.permissions, 'manage_invites');
}

/** Ban management capability: list banned users and unban (`ban_users`). */
export function canManageBans(caller: GroupCallerRules): boolean {
    return hasPermission(roleOf(caller), caller.permissions, 'ban_users');
}

/** Throws the shared 403 unless the caller may manage this group's bans. */
export function assertCanManageBans(caller: GroupCallerRules): void {
    requirePermission(caller, 'ban_users');
}

/**
 * Normalized member-permission config of a chat (groups only). Reads fill the
 * centralized defaults, so legacy rows and partial objects behave like the
 * full contract.
 */
export function memberPermissionsConfigOf(
    chat: Pick<Chat, 'memberPermissions'> | null | undefined,
): MemberPermissionsConfig {
    return normalizeMemberPermissions(chat?.memberPermissions);
}

/**
 * The member-permission gate: owners and admins always pass, regular members
 * follow the group's configured switches.
 */
export function memberPermissionAllowed(
    caller: Pick<GroupCallerRules, 'isOwner' | 'isAdmin'>,
    config: MemberPermissionsConfig,
    key: MemberPermission,
): boolean {
    if (caller.isOwner || caller.isAdmin) return true;
    return config[key] === true;
}

/**
 * THE add-members authorization rule, shared by the capability payload and the
 * enforcement path so the UI can never offer an action the server rejects:
 *   - owner / admin need `manage_members` (owner implicitly holds everything);
 *   - a regular member follows the EFFECTIVE `add_members` state (group default
 *     resolved with their individual allow/deny overrides).
 */
export function canAddMembersCapability(
    caller: GroupCallerRules,
    memberPermissions: MemberPermissionsConfig,
): boolean {
    if (caller.isOwner || caller.isAdmin) {
        return hasPermission(
            caller.isOwner ? 'owner' : 'admin',
            caller.permissions,
            'manage_members',
        );
    }
    return memberPermissionAllowed(caller, memberPermissions, 'add_members');
}

/**
 * Editing the group's member-permission configuration is an ADMIN capability:
 * the owner, or an admin holding the established `manage_permissions` grant.
 * A regular member can never change it, even with an explicit admin grant row.
 */
export function canManageMemberPermissions(caller: GroupCallerRules): boolean {
    if (caller.isOwner) return true;
    return (
        caller.isAdmin &&
        hasPermission('admin', caller.permissions, 'manage_permissions')
    );
}

/** Every capability `GET /chats/:chatId/group` exposes for the caller. */
export interface GroupCapabilities {
    canEditInfo: boolean;
    /** Contract name for `canManageInviteLinks` (kept as an alias). */
    canManageInvites: boolean;
    /** Legacy alias of `canManageInvites`; both always match. */
    canManageInviteLinks: boolean;
    canManageBans: boolean;
    canRemoveMembers: boolean;
    canManageMembers: boolean;
    canDeleteOthersMessages: boolean;
    canPinMessages: boolean;
    canManageAdmins: boolean;
    canManagePermissions: boolean;
    canRestrictMembers: boolean;
    canManageVoiceChats: boolean;
    /** Owner, or admin with `manage_permissions`: edits the member config. */
    canManageMemberPermissions: boolean;
    /** Owner/admin with `manage_members`, or a member with `add_members`. */
    canAddMembers: boolean;
    /** Owner/admin with `manage_invites`, or a member with `invite_via_link`. */
    canInviteViaLink: boolean;
}

/**
 * Capabilities offered to the caller. `memberPermissions` is the group's
 * configured member policy (defaults when omitted); regular members get the
 * member-level capabilities from it instead of the admin grant set.
 */
export function groupCapabilities(
    caller: GroupCallerRules,
    memberPermissions: MemberPermissionsConfig = normalizeMemberPermissions(
        undefined,
    ),
): GroupCapabilities {
    const role = roleOf(caller);
    const allowed = (key: GroupPermission): boolean =>
        hasPermission(role, caller.permissions, key);
    const memberAllowed = (key: MemberPermission): boolean =>
        memberPermissionAllowed(caller, memberPermissions, key);
    return {
        canEditInfo: allowed('edit_group_info'),
        canManageInvites: allowed('manage_invites'),
        canManageInviteLinks: allowed('manage_invites'),
        canManageBans: allowed('ban_users'),
        canRemoveMembers: allowed('remove_members'),
        canManageMembers: allowed('manage_members'),
        canDeleteOthersMessages: allowed('delete_other_messages'),
        // Admins keep their grant; regular members follow the group policy.
        canPinMessages:
            caller.isOwner || caller.isAdmin
                ? allowed('pin_messages')
                : memberAllowed('pin_messages'),
        canManageAdmins: allowed('manage_admins'),
        canManagePermissions: allowed('manage_permissions'),
        canRestrictMembers: allowed('restrict_members'),
        canManageVoiceChats: allowed('manage_voice_chats'),
        canManageMemberPermissions: canManageMemberPermissions(caller),
        canAddMembers: canAddMembersCapability(caller, memberPermissions),
        canInviteViaLink:
            caller.isOwner || caller.isAdmin
                ? allowed('manage_invites')
                : memberAllowed('invite_via_link'),
    };
}

/** Every contract permission key (documented API surface). */
export const GROUP_PERMISSION_KEYS: readonly GroupPermission[] =
    GROUP_PERMISSIONS;

@Injectable()
export class ChatPermissionService implements OnModuleInit {
    private readonly logger = new Logger(ChatPermissionService.name);

    constructor(
        @InjectRepository(ChatMember)
        private readonly memberRepository: Repository<ChatMember>,
        @InjectRepository(PermissionAdmin)
        private readonly permissionAdminRepository: Repository<PermissionAdmin>,
        private readonly memberPermissionResolver: MemberPermissionResolverService,
    ) {}

    /**
     * Dev/seed-safe legacy normalization. Reads already migrate names, but this
     * rewrites stored grants so old rows also disappear from raw queries. It is
     * idempotent and best effort: a failure never blocks startup (the read-time
     * migration keeps the API correct).
     */
    async onModuleInit(): Promise<void> {
        try {
            const manager = this.permissionAdminRepository.manager;
            await manager.query(
                `INSERT INTO "permission_chats" (name)
                 SELECT unnest($1::text[])
                 ON CONFLICT (name) DO NOTHING`,
                [[...GROUP_PERMISSIONS]],
            );
            for (const [legacy, current] of Object.entries(
                LEGACY_PERMISSION_ALIASES,
            )) {
                await manager.query(
                    `INSERT INTO "permission_admin" ("memberId", "permissionId")
                     SELECT pa."memberId", current.id
                       FROM "permission_admin" pa
                       JOIN "permission_chats" legacy ON legacy.id = pa."permissionId"
                       JOIN "permission_chats" current ON current.name = $2
                      WHERE legacy.name = $1
                        AND NOT EXISTS (
                            SELECT 1 FROM "permission_admin" dup
                             WHERE dup."memberId" = pa."memberId"
                               AND dup."permissionId" = current.id
                        )`,
                    [legacy, current],
                );
                await manager.query(
                    `DELETE FROM "permission_admin" pa
                      USING "permission_chats" p
                      WHERE pa."permissionId" = p.id AND p.name = $1`,
                    [legacy],
                );
            }
        } catch (error) {
            this.logger.warn(
                `legacy chat permission normalization skipped: ${String(error)}`,
            );
        }
    }

    async getCallerContext(
        chatId: ChatId,
        userId: UserId,
    ): Promise<ChatCallerContext> {
        const rows = await this.memberRepository.find({
            where: { chat: { id: chatId }, user: { id: userId } },
            relations: { chat: true, role: true },
            order: { id: 'ASC' },
        });
        if (rows.length === 0) {
            throw new ForbiddenException('you are not a member of this group');
        }

        const best = rows.reduce((current, candidate) =>
            roleRank(candidate.role?.name) > roleRank(current.role?.name)
                ? candidate
                : current,
        );
        const roleName = (best.role?.name ?? '') as RoleChatEnum;
        const role = toGroupRole(roleName);
        if (role === null) {
            throw new ForbiddenException(
                'you have been banned from this group',
            );
        }

        const memberIds = rows.map((row) => Number(row.id));
        const grants = await this.permissionAdminRepository.find({
            where: { member: { id: In(memberIds) } },
            relations: { permission: true },
        });
        // Legacy names are migrated on read; `all` is preserved as wildcard.
        const permissions = normalizePermissions(
            grants.map((grant) => grant.permission.name),
        ) as PermissionChatEnum[];
        const effectiveMemberPermissions =
            await this.memberPermissionResolver.resolve(best.chat, userId);

        return {
            chat: best.chat,
            member: best,
            memberIds,
            roleName,
            role,
            permissions,
            isOwner: role === 'owner',
            isAdmin: role === 'admin',
            effectiveMemberPermissions,
        };
    }

    /** 400 for private chats ("This action is only available in groups"). */
    assertGroup(caller: ChatCallerContext): void {
        if (caller.chat.type !== TypeChatEnum.GRUPE) {
            throw new BadRequestException(
                'This action is only available in groups',
            );
        }
        if (caller.chat.isBan) {
            throw new ForbiddenException('this chat has been banned');
        }
    }
}
