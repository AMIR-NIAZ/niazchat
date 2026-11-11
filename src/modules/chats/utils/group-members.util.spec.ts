import { PermissionChatEnum } from 'src/common/enums/permissionChat.enum';
import { RoleChatEnum } from 'src/common/enums/roleChat.enum';
import {
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
    parseEditablePermissions,
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
};
const ADMIN_WITH_BAN: GroupCallerRules = {
    isOwner: false,
    isAdmin: true,
    permissions: [PermissionChatEnum.BAN_USER],
};
const ADMIN_WITH_ALL: GroupCallerRules = {
    isOwner: false,
    isAdmin: true,
    permissions: [PermissionChatEnum.ALL],
};
const ADMIN_WITHOUT_BAN: GroupCallerRules = {
    isOwner: false,
    isAdmin: true,
    permissions: [PermissionChatEnum.DELETE_MESSAGE],
};
const MEMBER: GroupCallerRules = {
    isOwner: false,
    isAdmin: false,
    permissions: [],
};

const TARGETS: GroupRole[] = ['owner', 'admin', 'member'];

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

    it('admin removes a member only with ban_user or all', () => {
        expect(canRemove(ADMIN_WITH_BAN, 'member')).toBe(true);
        expect(canRemove(ADMIN_WITH_ALL, 'member')).toBe(true);
        expect(canRemove(ADMIN_WITHOUT_BAN, 'member')).toBe(false);
        expect(canRemove(ADMIN_WITH_BAN, 'admin')).toBe(false);
        expect(canRemove(ADMIN_WITH_BAN, 'owner')).toBe(false);
    });

    it('admin can never promote, demote or touch another admin/owner', () => {
        for (const admin of [
            ADMIN_WITH_BAN,
            ADMIN_WITH_ALL,
            ADMIN_WITHOUT_BAN,
        ]) {
            for (const target of TARGETS) {
                expect(canPromote(admin, target)).toBe(false);
                expect(canDemote(admin, target)).toBe(false);
            }
            expect(canRemove(admin, 'admin')).toBe(false);
            expect(canRemove(admin, 'owner')).toBe(false);
        }
    });

    it('plain member has no management action on any target', () => {
        for (const target of TARGETS) {
            expect(canPromote(MEMBER, target)).toBe(false);
            expect(canDemote(MEMBER, target)).toBe(false);
            expect(canRemove(MEMBER, target)).toBe(false);
        }
    });

    it('row actions mirror the same rules', () => {
        expect(memberActions(OWNER, 'member')).toEqual({
            canPromote: true,
            canDemote: false,
            canRemove: true,
            canEditPermissions: false,
        });
        expect(memberActions(OWNER, 'admin')).toEqual({
            canPromote: false,
            canDemote: true,
            canRemove: true,
            canEditPermissions: true,
        });
        expect(memberActions(OWNER, 'owner')).toEqual({
            canPromote: false,
            canDemote: false,
            canRemove: false,
            canEditPermissions: false,
        });
        expect(memberActions(ADMIN_WITH_BAN, 'member')).toEqual({
            canPromote: false,
            canDemote: false,
            canRemove: true,
            canEditPermissions: false,
        });
        expect(memberActions(ADMIN_WITHOUT_BAN, 'member')).toEqual({
            canPromote: false,
            canDemote: false,
            canRemove: false,
            canEditPermissions: false,
        });
        expect(memberActions(MEMBER, 'member')).toEqual({
            canPromote: false,
            canDemote: false,
            canRemove: false,
            canEditPermissions: false,
        });
    });

    it('only the owner may edit an admin, never a member/owner/self', () => {
        expect(canEditPermissions(OWNER, 'admin')).toBe(true);
        expect(canEditPermissions(OWNER, 'member')).toBe(false);
        expect(canEditPermissions(OWNER, 'owner')).toBe(false);
        expect(canEditPermissions(ADMIN_WITH_ALL, 'admin')).toBe(false);
        expect(canEditPermissions(ADMIN_WITH_BAN, 'member')).toBe(false);
        expect(canEditPermissions(MEMBER, 'admin')).toBe(false);
    });
});

describe('permission editor payloads', () => {
    it('accepts an empty set and any unique editable subset', () => {
        expect(parseEditablePermissions([])).toEqual([]);
        expect(parseEditablePermissions(['ban_user'])).toEqual(['ban_user']);
        expect(
            parseEditablePermissions([
                'ban_user',
                'delete_message',
                'change_info_chat',
            ]),
        ).toEqual(['ban_user', 'delete_message', 'change_info_chat']);
    });

    it('rejects all, unknown names, duplicates, non-arrays and >3 entries', () => {
        expect(parseEditablePermissions(['all'])).toBeNull();
        expect(parseEditablePermissions(['unknown'])).toBeNull();
        expect(parseEditablePermissions([1])).toBeNull();
        expect(parseEditablePermissions('ban_user')).toBeNull();
        expect(
            parseEditablePermissions(['ban_user', 'ban_user']),
        ).toBeNull();
        expect(
            parseEditablePermissions([
                'ban_user',
                'delete_message',
                'change_info_chat',
                'ban_user',
            ]),
        ).toBeNull();
    });

    it('compares sets without depending on order', () => {
        expect(
            samePermissionSet(
                ['ban_user', 'delete_message'],
                ['delete_message', 'ban_user'],
            ),
        ).toBe(true);
        expect(samePermissionSet(['ban_user'], [])).toBe(false);
        expect(
            samePermissionSet(['ban_user'], ['ban_user', 'change_info_chat']),
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
