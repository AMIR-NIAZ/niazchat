import { PermissionChatEnum } from 'src/common/enums/permissionChat.enum';
import { RoleChatEnum } from 'src/common/enums/roleChat.enum';
import {
    canBan,
    canDemote,
    canEditPermissions,
    canPromote,
    canRemove,
    compareMembersForList,
    decodeMemberCursor,
    dedupeMembersByUser,
    encodeMemberCursor,
    escapeLikeTerm,
    memberActions,
    roleRank,
    samePermissionSet,
    sortMembersForList,
    toGroupRole,
} from './group-members.util';
import type { GroupCallerRules, GroupRole } from './group-members.util';

const OWNER: GroupCallerRules = {
    isOwner: true,
    isAdmin: false,
    permissions: [],
    userId: 1,
};
const ADMIN_BAN: GroupCallerRules = {
    isOwner: false,
    isAdmin: true,
    permissions: [PermissionChatEnum.BAN_USERS],
    userId: 2,
};
const ADMIN_REMOVE: GroupCallerRules = {
    isOwner: false,
    isAdmin: true,
    permissions: [PermissionChatEnum.REMOVE_MEMBERS],
    userId: 2,
};
const ADMIN_ALL: GroupCallerRules = {
    isOwner: false,
    isAdmin: true,
    permissions: [PermissionChatEnum.ALL],
    userId: 2,
};
const ADMIN_MANAGE_ADMINS: GroupCallerRules = {
    isOwner: false,
    isAdmin: true,
    permissions: [PermissionChatEnum.MANAGE_ADMINS],
    userId: 2,
};
const ADMIN_MANAGE_PERMISSIONS: GroupCallerRules = {
    isOwner: false,
    isAdmin: true,
    permissions: [PermissionChatEnum.MANAGE_PERMISSIONS],
    userId: 2,
};
const ADMIN_WITHOUT_RIGHTS: GroupCallerRules = {
    isOwner: false,
    isAdmin: true,
    permissions: [PermissionChatEnum.DELETE_OTHER_MESSAGES],
    userId: 2,
};
const MEMBER: GroupCallerRules = {
    isOwner: false,
    isAdmin: false,
    permissions: [],
    userId: 3,
};

const TARGETS: GroupRole[] = ['owner', 'admin', 'member'];
const OWN_PROMOTEE = { promotedById: 2, callerUserId: 2 };
const OTHER_PROMOTEE = { promotedById: 9, callerUserId: 2 };

describe('group role mapping', () => {
    it('maps seeded role names to wire roles', () => {
        expect(toGroupRole(RoleChatEnum.MANAGER)).toBe('owner');
        expect(toGroupRole(RoleChatEnum.ADMIN)).toBe('admin');
        expect(toGroupRole(RoleChatEnum.USER)).toBe('member');
        expect(toGroupRole(RoleChatEnum.BAN)).toBeNull();
        expect(toGroupRole(null)).toBeNull();
    });

    it('ranks owner above admin above member above banned', () => {
        expect(roleRank(RoleChatEnum.MANAGER)).toBe(3);
        expect(roleRank(RoleChatEnum.ADMIN)).toBe(2);
        expect(roleRank(RoleChatEnum.USER)).toBe(1);
        expect(roleRank(RoleChatEnum.BAN)).toBe(0);
    });
});

describe('permission matrix', () => {
    it('owner may promote and demote, never the owner row', () => {
        expect(canPromote(OWNER, 'member')).toBe(true);
        expect(canPromote(OWNER, 'admin')).toBe(false);
        expect(canPromote(OWNER, 'owner')).toBe(false);
        expect(canDemote(OWNER, 'admin')).toBe(true);
        expect(canDemote(OWNER, 'member')).toBe(false);
        expect(canDemote(OWNER, 'owner')).toBe(false);
    });

    it('owner may remove admins and members, never the owner', () => {
        expect(canRemove(OWNER, 'member')).toBe(true);
        expect(canRemove(OWNER, 'admin')).toBe(true);
        expect(canRemove(OWNER, 'owner')).toBe(false);
    });

    it('admin removes a member only with remove_members or all', () => {
        expect(canRemove(ADMIN_REMOVE, 'member')).toBe(true);
        expect(canRemove(ADMIN_ALL, 'member')).toBe(true);
        expect(canRemove(ADMIN_BAN, 'member')).toBe(false);
        expect(canRemove(ADMIN_REMOVE, 'admin')).toBe(false);
        expect(canRemove(ADMIN_REMOVE, 'owner')).toBe(false);
    });

    it('owner bans members and admins, never the owner', () => {
        expect(canBan(OWNER, 'member')).toBe(true);
        expect(canBan(OWNER, 'admin')).toBe(true);
        expect(canBan(OWNER, 'owner')).toBe(false);
    });

    it('admin bans members only with ban_users or all', () => {
        expect(canBan(ADMIN_BAN, 'member')).toBe(true);
        expect(canBan(ADMIN_ALL, 'member')).toBe(true);
        expect(canBan(ADMIN_REMOVE, 'member')).toBe(false);
        expect(canBan(ADMIN_BAN, 'owner')).toBe(false);
        expect(canBan(ADMIN_BAN, 'admin')).toBe(false);
    });

    it('plain member can manage nobody', () => {
        for (const target of TARGETS) {
            expect(canBan(MEMBER, target)).toBe(false);
            expect(canRemove(MEMBER, target)).toBe(false);
        }
    });

    it('admins without manage_admins can never promote or demote', () => {
        for (const admin of [ADMIN_BAN, ADMIN_REMOVE]) {
            for (const target of TARGETS) {
                expect(canPromote(admin, target)).toBe(false);
                expect(canDemote(admin, target)).toBe(false);
            }
        }
    });

    it('all implies manage_admins but still only own promotees', () => {
        expect(canPromote(ADMIN_ALL, 'member')).toBe(true);
        expect(canDemote(ADMIN_ALL, 'admin', OWN_PROMOTEE)).toBe(true);
        expect(canDemote(ADMIN_ALL, 'admin', OTHER_PROMOTEE)).toBe(false);
    });

    it('manage_admins promotes members and demotes only own promotees', () => {
        expect(canPromote(ADMIN_MANAGE_ADMINS, 'member')).toBe(true);
        expect(canPromote(ADMIN_MANAGE_ADMINS, 'admin')).toBe(false);
        expect(canDemote(ADMIN_MANAGE_ADMINS, 'admin', OWN_PROMOTEE)).toBe(
            true,
        );
        expect(canDemote(ADMIN_MANAGE_ADMINS, 'admin', OTHER_PROMOTEE)).toBe(
            false,
        );
        expect(canDemote(ADMIN_MANAGE_ADMINS, 'admin', {})).toBe(false);
        expect(canDemote(ADMIN_MANAGE_ADMINS, 'owner', OWN_PROMOTEE)).toBe(
            false,
        );
    });

    it('manage_permissions edits only own promoted admins', () => {
        expect(canEditPermissions(OWNER, 'admin')).toBe(true);
        expect(
            canEditPermissions(ADMIN_MANAGE_PERMISSIONS, 'admin', OWN_PROMOTEE),
        ).toBe(true);
        expect(
            canEditPermissions(
                ADMIN_MANAGE_PERMISSIONS,
                'admin',
                OTHER_PROMOTEE,
            ),
        ).toBe(false);
        expect(canEditPermissions(ADMIN_MANAGE_PERMISSIONS, 'member')).toBe(
            false,
        );
        expect(canEditPermissions(ADMIN_WITHOUT_RIGHTS, 'admin')).toBe(false);
        expect(canEditPermissions(MEMBER, 'admin')).toBe(false);
    });

    it('row actions mirror the same rules', () => {
        expect(memberActions(OWNER, 'member')).toEqual({
            canPromote: true,
            canDemote: false,
            canRemove: true,
            canEditPermissions: false,
            canBan: true,
            canManageMemberPermissions: true,
        });
        expect(memberActions(OWNER, 'admin')).toEqual({
            canPromote: false,
            canDemote: true,
            canRemove: true,
            canEditPermissions: true,
            canBan: true,
            canManageMemberPermissions: false,
        });
        expect(memberActions(OWNER, 'owner')).toEqual({
            canPromote: false,
            canDemote: false,
            canRemove: false,
            canEditPermissions: false,
            canBan: false,
            canManageMemberPermissions: false,
        });
        expect(memberActions(ADMIN_BAN, 'member')).toEqual({
            canPromote: false,
            canDemote: false,
            canRemove: false,
            canEditPermissions: false,
            canBan: true,
            canManageMemberPermissions: false,
        });
        expect(
            memberActions(ADMIN_MANAGE_ADMINS, 'admin', OWN_PROMOTEE),
        ).toEqual({
            canPromote: false,
            canDemote: true,
            canRemove: false,
            canEditPermissions: false,
            canBan: false,
            canManageMemberPermissions: false,
        });
        expect(memberActions(MEMBER, 'member')).toEqual({
            canPromote: false,
            canDemote: false,
            canRemove: false,
            canEditPermissions: false,
            canBan: false,
            canManageMemberPermissions: false,
        });
        // Individual overrides are a manage_permissions capability on members
        // only; admins/owners keep their role-based powers.
        expect(
            memberActions(ADMIN_MANAGE_PERMISSIONS, 'member')
                .canManageMemberPermissions,
        ).toBe(true);
        expect(
            memberActions(ADMIN_MANAGE_ADMINS, 'member')
                .canManageMemberPermissions,
        ).toBe(false);
        expect(memberActions(OWNER, 'owner').canManageMemberPermissions).toBe(
            false,
        );
        expect(memberActions(OWNER, 'admin').canManageMemberPermissions).toBe(
            false,
        );
    });
});

describe('permission set comparison', () => {
    it('compares sets without depending on order', () => {
        expect(
            samePermissionSet(
                ['ban_users', 'delete_other_messages'],
                ['delete_other_messages', 'ban_users'],
            ),
        ).toBe(true);
        expect(samePermissionSet(['ban_users'], [])).toBe(false);
        expect(
            samePermissionSet(['ban_users'], ['ban_users', 'edit_group_info']),
        ).toBe(false);
    });
});

describe('keyset cursors', () => {
    it('round-trips rank and member id', () => {
        const encoded = encodeMemberCursor(2, 81);
        expect(decodeMemberCursor(encoded)).toEqual({ rank: 2, memberId: 81 });
    });

    it('rejects malformed, unknown-version and out-of-range cursors', () => {
        expect(decodeMemberCursor('not-a-cursor')).toBeNull();
        expect(
            decodeMemberCursor(Buffer.from('v2:2:81').toString('base64url')),
        ).toBeNull();
        expect(
            decodeMemberCursor(Buffer.from('v1:9:81').toString('base64url')),
        ).toBeNull();
        expect(
            decodeMemberCursor(Buffer.from('v1:2:-1').toString('base64url')),
        ).toBeNull();
    });
});

describe('search escaping', () => {
    it('escapes LIKE wildcards and the escape character', () => {
        expect(escapeLikeTerm('100%_done')).toBe('100\\%\\_done');
        expect(escapeLikeTerm('a\\b')).toBe('a\\\\b');
    });
});

describe('duplicate members', () => {
    const rows = [
        { memberId: 9, userId: 4, role: 'member' as const },
        { memberId: 3, userId: 4, role: 'admin' as const },
        { memberId: 5, userId: 8, role: 'member' as const },
        { memberId: 2, userId: 1, role: 'owner' as const },
    ];

    it('keeps the highest-ranking row, then the lowest member id', () => {
        expect(dedupeMembersByUser(rows)).toEqual([
            { memberId: 3, userId: 4, role: 'admin' },
            { memberId: 5, userId: 8, role: 'member' },
            { memberId: 2, userId: 1, role: 'owner' },
        ]);
        const tie = dedupeMembersByUser([
            { memberId: 7, userId: 4, role: 'admin' as const },
            { memberId: 3, userId: 4, role: 'admin' as const },
        ]);
        expect(tie).toEqual([{ memberId: 3, userId: 4, role: 'admin' }]);
    });

    it('orders owner, admins, members and then member id', () => {
        const sorted = sortMembersForList(dedupeMembersByUser(rows));
        expect(sorted.map((row) => row.memberId)).toEqual([2, 3, 5]);
        expect(
            compareMembersForList(
                { memberId: 9, userId: 1, role: 'admin' },
                { memberId: 1, userId: 2, role: 'member' },
            ),
        ).toBeLessThan(0);
    });
});
