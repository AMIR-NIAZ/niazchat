import { PermissionChatEnum } from 'src/common/enums/permissionChat.enum';
import type { GroupCallerRules } from '../utils/group-members.util';
import {
    canEditInfo,
    canManageInviteLinks,
    groupCapabilities,
} from './chat-permission.service';

function rules(overrides: Partial<GroupCallerRules> = {}): GroupCallerRules {
    return {
        isOwner: false,
        isAdmin: false,
        permissions: [],
        ...overrides,
    };
}

describe('canManageInviteLinks', () => {
    it('allows the owner', () => {
        expect(canManageInviteLinks(rules({ isOwner: true }))).toBe(true);
    });

    it('allows an admin holding manage_invites', () => {
        expect(
            canManageInviteLinks(
                rules({
                    isAdmin: true,
                    permissions: [PermissionChatEnum.MANAGE_INVITES],
                }),
            ),
        ).toBe(true);
    });

    it('rejects an admin without manage_invites', () => {
        expect(canManageInviteLinks(rules({ isAdmin: true }))).toBe(false);
    });

    it('rejects members, banned users and outsiders', () => {
        expect(canManageInviteLinks(rules({}))).toBe(false);
        expect(
            canManageInviteLinks(
                rules({
                    isAdmin: false,
                    permissions: [PermissionChatEnum.ALL],
                }),
            ),
        ).toBe(false);
    });
});

describe('canEditInfo', () => {
    it('allows the owner regardless of permission rows', () => {
        expect(canEditInfo(rules({ isOwner: true }))).toBe(true);
    });

    it('allows an admin holding change_info_chat', () => {
        expect(
            canEditInfo(
                rules({
                    isAdmin: true,
                    permissions: [PermissionChatEnum.CHANGE_INFO_CHAT],
                }),
            ),
        ).toBe(true);
    });

    it('lets the legacy all grant bypass the check for an admin', () => {
        expect(
            canEditInfo(
                rules({
                    isAdmin: true,
                    permissions: [PermissionChatEnum.ALL],
                }),
            ),
        ).toBe(true);
    });

    it('rejects an admin without change_info_chat or all', () => {
        expect(
            canEditInfo(
                rules({
                    isAdmin: true,
                    permissions: [
                        PermissionChatEnum.BAN_USER,
                        PermissionChatEnum.DELETE_MESSAGE,
                    ],
                }),
            ),
        ).toBe(false);
        expect(canEditInfo(rules({ isAdmin: true }))).toBe(false);
    });

    it('rejects members, banned users and outsiders', () => {
        // Members: not owner, not admin (permissions are never granted to them).
        expect(canEditInfo(rules({}))).toBe(false);
        // Banned/outsider callers never reach this rule (getCallerContext
        // rejects them); the pure rule must still answer false.
        expect(
            canEditInfo(
                rules({
                    isOwner: false,
                    isAdmin: false,
                    permissions: [PermissionChatEnum.ALL],
                }),
            ),
        ).toBe(false);
    });
});

describe('groupCapabilities', () => {
    it('gives the owner every capability', () => {
        const capabilities = groupCapabilities(rules({ isOwner: true }));
        expect(Object.values(capabilities).every(Boolean)).toBe(true);
        expect(capabilities.canManagePermissions).toBe(true);
        expect(capabilities.canManageAdmins).toBe(true);
    });

    it('derives each flag from the matching key, including implications', () => {
        const capabilities = groupCapabilities(
            rules({
                isAdmin: true,
                permissions: [
                    PermissionChatEnum.DELETE_MESSAGE,
                    PermissionChatEnum.MANAGE_MESSAGES,
                ],
            }),
        );
        expect(capabilities.canDeleteOthersMessages).toBe(true);
        expect(capabilities.canPinMessages).toBe(true);
        expect(capabilities.canManageMembers).toBe(false);
        expect(capabilities.canManageBans).toBe(false);
    });

    it('exposes inactive permissions but never claims them by default', () => {
        const capabilities = groupCapabilities(rules({ isAdmin: true }));
        expect(capabilities.canRestrictMembers).toBe(false);
        expect(capabilities.canManageVoiceChats).toBe(false);
        expect(
            groupCapabilities(
                rules({
                    isAdmin: true,
                    permissions: [PermissionChatEnum.RESTRICT_MEMBERS],
                }),
            ).canRestrictMembers,
        ).toBe(true);
    });
});
