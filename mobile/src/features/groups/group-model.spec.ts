import { ApiError } from '../../core/api';
import {
    GROUP_DESCRIPTION_MAX_LENGTH,
    GROUP_TITLE_MAX_LENGTH,
    canOpenGroupSettings,
    canSaveGroupInfo,
    groupDescriptionError,
    groupInfoChanges,
    groupInfoQueryKey,
    groupMembersPrefix,
    groupMembersQueryKey,
    groupTitleError,
    hasMemberActions,
    isGroupInfoDirty,
    memberActionLabel,
    memberPermissionsPrefix,
    memberPermissionsQueryKey,
    patchMembersPages,
    permissionDescription,
    permissionSetEquals,
    roleBadgeLabel,
    togglePermissionSelection,
    visibleGroupSettingsFeatures,
    visibleMemberActions,
} from './group-model';
import type { GroupMember, GroupMemberPage } from './group-model';
import { describeMemberActionError } from './group-errors';

function member(overrides: Partial<GroupMember> = {}): GroupMember {
    return {
        memberId: 10,
        userId: 7,
        name: 'Member',
        username: 'member',
        avatars: [],
        isOnline: false,
        lastSeen: null,
        role: 'member',
        actions: {
            canPromote: true,
            canDemote: false,
            canRemove: true,
            canEditPermissions: false,
        },
        ...overrides,
    };
}

function page(
    items: GroupMember[],
    nextCursor: string | null = null,
): GroupMemberPage {
    return { items, nextCursor };
}

describe('group query keys', () => {
    it('uses one info key and a per-search members key', () => {
        expect(groupInfoQueryKey(12)).toEqual(['group', 12]);
        expect(groupMembersQueryKey(12, '')).toEqual([
            'group',
            12,
            'members',
            '',
        ]);
        expect(groupMembersQueryKey(12, 'sara')).toEqual([
            'group',
            12,
            'members',
            'sara',
        ]);
        expect(groupMembersPrefix(12)).toEqual(['group', 12, 'members']);
        expect(memberPermissionsQueryKey(12, 8)).toEqual([
            'group',
            12,
            'permissions',
            8,
        ]);
        expect(memberPermissionsPrefix(12)).toEqual([
            'group',
            12,
            'permissions',
        ]);
    });
});

describe('action visibility', () => {
    it('renders only the permitted actions in menu order', () => {
        expect(
            visibleMemberActions({
                canPromote: true,
                canDemote: false,
                canRemove: true,
                canEditPermissions: false,
            }),
        ).toEqual(['promote', 'remove']);
        expect(
            visibleMemberActions({
                canPromote: false,
                canDemote: true,
                canRemove: true,
                canEditPermissions: true,
            }),
        ).toEqual(['permissions', 'demote', 'remove']);
        expect(
            visibleMemberActions({
                canPromote: false,
                canDemote: false,
                canRemove: true,
                canEditPermissions: false,
            }),
        ).toEqual(['remove']);
        expect(
            visibleMemberActions({
                canPromote: false,
                canDemote: false,
                canRemove: false,
                canEditPermissions: false,
            }),
        ).toEqual([]);
    });

    it('hides the trigger when no action is permitted', () => {
        expect(
            hasMemberActions({
                canPromote: false,
                canDemote: false,
                canRemove: false,
                canEditPermissions: false,
            }),
        ).toBe(false);
        expect(
            hasMemberActions({
                canPromote: false,
                canDemote: false,
                canRemove: true,
                canEditPermissions: false,
            }),
        ).toBe(true);
        expect(
            hasMemberActions({
                canPromote: false,
                canDemote: false,
                canRemove: false,
                canEditPermissions: true,
            }),
        ).toBe(true);
    });

    it('labels actions and badges', () => {
        expect(memberActionLabel('permissions')).toBe('Edit permissions');
        expect(memberActionLabel('promote')).toBe('Make admin');
        expect(memberActionLabel('demote')).toBe('Remove admin');
        expect(memberActionLabel('remove')).toBe('Remove from group');
        expect(roleBadgeLabel('owner')).toBe('Owner');
        expect(roleBadgeLabel('admin')).toBe('Admin');
        expect(roleBadgeLabel('member')).toBeNull();
    });
});

describe('members cache updates', () => {
    it('patches a promoted role in place without reordering', () => {
        const pages = [page([member(), member({ memberId: 11, userId: 8 })])];
        const next = patchMembersPages(pages, 10, 'admin');
        expect(next[0]?.items[0]?.role).toBe('admin');
        expect(next[0]?.items[1]?.role).toBe('member');
        expect(next[0]?.items[0]?.memberId).toBe(10);
        expect(pages[0]?.items[0]?.role).toBe('member');
    });

    it('removes a removed row from every cached page', () => {
        const pages = [
            page([member(), member({ memberId: 11, userId: 8 })]),
            page([member({ memberId: 12, userId: 9 })]),
        ];
        const next = patchMembersPages(pages, 11, null);
        expect(next[0]?.items.map((row) => row.memberId)).toEqual([10]);
        expect(next[1]?.items.map((row) => row.memberId)).toEqual([12]);
    });

    it('keeps pages untouched when the member is not present', () => {
        const pages = [page([member()])];
        expect(patchMembersPages(pages, 999, 'admin')).toEqual(pages);
    });
});

describe('permission editor helpers', () => {
    it('detects dirty sets ignoring order', () => {
        expect(permissionSetEquals([], [])).toBe(true);
        expect(
            permissionSetEquals(
                ['ban_user', 'delete_message'],
                ['delete_message', 'ban_user'],
            ),
        ).toBe(true);
        expect(permissionSetEquals(['ban_user'], [])).toBe(false);
        expect(
            permissionSetEquals(['ban_user'], ['ban_user', 'change_info_chat']),
        ).toBe(false);
    });

    it('toggles one permission without mutating the current set', () => {
        const current = ['ban_user'] as const;
        expect(togglePermissionSelection(current, 'delete_message')).toEqual([
            'ban_user',
            'delete_message',
        ]);
        expect(togglePermissionSelection(current, 'ban_user')).toEqual([]);
        expect(current).toEqual(['ban_user']);
    });

    it('has the exact descriptions shown in the sheet', () => {
        expect(permissionDescription('ban_user')).toBe(
            'can remove regular members from the group',
        );
        expect(permissionDescription('delete_message')).toBe(
            "can delete other members' messages",
        );
        expect(permissionDescription('change_info_chat')).toBe(
            "can change the group's title and photo",
        );
    });
});

describe('mutation error messages', () => {
    const error = (statusCode: number): ApiError =>
        new ApiError({
            success: false,
            statusCode,
            message: 'server message',
        });

    it('maps 403, 404 and 409 to specific guidance', () => {
        expect(describeMemberActionError(error(403))).toBe(
            "You don't have permission to do this.",
        );
        expect(describeMemberActionError(error(404))).toBe(
            'That member is no longer in this group.',
        );
        expect(describeMemberActionError(error(409))).toBe(
            'This member changed meanwhile. Pull to refresh and try again.',
        );
    });

    it('maps 400 to the group-only message', () => {
        expect(describeMemberActionError(error(400))).toBe(
            'This action is only available in groups.',
        );
    });
});

describe('group settings access', () => {
    it('offers the gear to the owner and admins only', () => {
        expect(canOpenGroupSettings('owner')).toBe(true);
        expect(canOpenGroupSettings('admin')).toBe(true);
        expect(canOpenGroupSettings('member')).toBe(false);
        expect(canOpenGroupSettings(null)).toBe(false);
        expect(canOpenGroupSettings(undefined)).toBe(false);
    });

    it('renders only features whose capability is true', () => {
        const rows = visibleGroupSettingsFeatures({
            canEditInfo: true,
            canManageInviteLinks: false,
        });
        expect(rows.map((row) => row.key)).toEqual(['group_info']);
        expect(rows[0]?.title).toBe('Group info');
        expect(rows[0]?.subtitle).toBe('Name, photo and description');
        expect(rows[0]?.route(12)).toBe('/group-settings/12/info');

        const links = visibleGroupSettingsFeatures({
            canEditInfo: false,
            canManageInviteLinks: true,
        });
        expect(links.map((row) => row.key)).toEqual(['invite_links']);
        expect(links[0]?.title).toBe('Invite links');
        expect(links[0]?.route(12)).toBe(
            '/group-settings/12/invite-links',
        );

        expect(
            visibleGroupSettingsFeatures({
                canEditInfo: false,
                canManageInviteLinks: false,
            }),
        ).toEqual([]);
        expect(visibleGroupSettingsFeatures(null)).toEqual([]);
    });
});

describe('group info form helpers', () => {
    const saved = { title: 'Team', description: 'Old text' };

    it('validates the title and description limits', () => {
        expect(groupTitleError('')).toBe('A group name is required.');
        expect(groupTitleError('   ')).toBe('A group name is required.');
        expect(groupTitleError('x'.repeat(GROUP_TITLE_MAX_LENGTH))).toBeNull();
        expect(
            groupTitleError('x'.repeat(GROUP_TITLE_MAX_LENGTH + 1)),
        ).not.toBeNull();
        expect(
            groupDescriptionError('y'.repeat(GROUP_DESCRIPTION_MAX_LENGTH)),
        ).toBeNull();
        expect(
            groupDescriptionError('y'.repeat(GROUP_DESCRIPTION_MAX_LENGTH + 1)),
        ).not.toBeNull();
    });

    it('detects no change for trimmed equal values', () => {
        expect(
            groupInfoChanges(
                { title: '  Team  ', description: ' Old text ' },
                saved,
            ),
        ).toBeNull();
        expect(
            isGroupInfoDirty(
                { title: '  Team  ', description: ' Old text ' },
                saved,
            ),
        ).toBe(false);
    });

    it('sends only the changed fields and clears an empty description', () => {
        expect(
            groupInfoChanges({ title: 'New', description: 'Old text' }, saved),
        ).toEqual({ title: 'New' });
        expect(
            groupInfoChanges({ title: 'Team', description: '   ' }, saved),
        ).toEqual({ description: null });
        expect(
            groupInfoChanges(
                { title: 'Team', description: '' },
                {
                    title: 'Team',
                    description: null,
                },
            ),
        ).toBeNull();
    });

    it('disables saving until dirty, valid and not already saving', () => {
        const draft = { title: 'New', description: '' };
        expect(canSaveGroupInfo(draft, saved, false)).toBe(true);
        expect(canSaveGroupInfo(draft, saved, true)).toBe(false);
        expect(canSaveGroupInfo(draft, draft, false)).toBe(false);
        expect(
            canSaveGroupInfo({ title: ' ', description: '' }, saved, false),
        ).toBe(false);
    });
});
