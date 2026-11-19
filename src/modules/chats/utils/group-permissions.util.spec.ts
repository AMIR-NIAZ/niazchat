import {
    GROUP_PERMISSIONS,
    PERMISSION_META,
    canGrantPermissions,
    explicitPermissions,
    hasPermission,
    normalizePermissionName,
    normalizePermissions,
    parsePermissionsInput,
    permissionSummary,
} from './group-permissions.util';

describe('group permission contract', () => {
    it('has the 12 keys with English and Persian labels', () => {
        expect(GROUP_PERMISSIONS).toHaveLength(12);
        for (const key of GROUP_PERMISSIONS) {
            expect(PERMISSION_META[key].en.length).toBeGreaterThan(0);
            expect(PERMISSION_META[key].fa.length).toBeGreaterThan(0);
            expect(typeof PERMISSION_META[key].active).toBe('boolean');
        }
        expect(PERMISSION_META.manage_voice_chats.active).toBe(false);
        expect(PERMISSION_META.restrict_members.active).toBe(false);
    });

    it('documents the manage_messages umbrella', () => {
        expect(PERMISSION_META.manage_messages.implies).toEqual([
            'delete_other_messages',
            'pin_messages',
        ]);
    });
});

describe('legacy normalization', () => {
    it('maps every old value to its new key and keeps all', () => {
        expect(normalizePermissionName('change_info_chat')).toBe(
            'edit_group_info',
        );
        expect(normalizePermissionName('ban_user')).toBe('ban_users');
        expect(normalizePermissionName('delete_message')).toBe(
            'delete_other_messages',
        );
        expect(normalizePermissionName('pin_message')).toBe('pin_messages');
        expect(normalizePermissionName('all')).toBe('all');
        expect(normalizePermissionName('unknown')).toBeNull();
    });

    it('deduplicates migrated values and drops unknown names', () => {
        expect(
            normalizePermissions([
                'delete_message',
                'delete_other_messages',
                'ban_user',
                'nope',
                'all',
            ]),
        ).toEqual(['delete_other_messages', 'ban_users', 'all']);
        expect(
            explicitPermissions(['delete_message', 'all', 'pin_message']),
        ).toEqual(['delete_other_messages', 'pin_messages']);
    });
});

describe('hasPermission', () => {
    it('gives the owner everything regardless of stored grants', () => {
        for (const key of GROUP_PERMISSIONS) {
            expect(hasPermission('owner', [], key)).toBe(true);
        }
    });

    it('treats all as a wildcard', () => {
        expect(hasPermission('admin', ['all'], 'manage_permissions')).toBe(
            true,
        );
    });

    it('resolves implications', () => {
        expect(
            hasPermission(
                'admin',
                ['manage_messages'],
                'delete_other_messages',
            ),
        ).toBe(true);
        expect(
            hasPermission('admin', ['manage_messages'], 'pin_messages'),
        ).toBe(true);
        expect(hasPermission('admin', ['manage_messages'], 'ban_users')).toBe(
            false,
        );
    });

    it('accepts legacy grants on read', () => {
        expect(
            hasPermission('admin', ['change_info_chat'], 'edit_group_info'),
        ).toBe(true);
        expect(
            hasPermission('admin', ['delete_message'], 'delete_other_messages'),
        ).toBe(true);
    });

    it('denies members and unknown keys', () => {
        expect(hasPermission('member', [], 'edit_group_info')).toBe(false);
        expect(hasPermission('admin', ['ban_users'], 'manage_admins')).toBe(
            false,
        );
    });
});

describe('granting permissions', () => {
    it('lets the owner grant anything', () => {
        expect(canGrantPermissions('owner', [], GROUP_PERMISSIONS)).toBe(true);
    });

    it('requires an admin to hold every key they grant', () => {
        expect(canGrantPermissions('admin', ['ban_users'], ['ban_users'])).toBe(
            true,
        );
        expect(
            canGrantPermissions(
                'admin',
                ['ban_users'],
                ['ban_users', 'manage_permissions'],
            ),
        ).toBe(false);
        expect(
            canGrantPermissions(
                'admin',
                ['manage_messages'],
                ['delete_other_messages', 'pin_messages'],
            ),
        ).toBe(true);
    });
});

describe('permission payload validation', () => {
    it('accepts arrays, removes duplicates and migrates legacy names', () => {
        expect(parsePermissionsInput([])).toEqual({ all: false, keys: [] });
        expect(
            parsePermissionsInput([
                'ban_user',
                'ban_users',
                'delete_message',
                'unknown',
            ]),
        ).toBeNull();
        expect(parsePermissionsInput(['ban_user', 'ban_users', 'all'])).toEqual(
            { all: true, keys: ['ban_users'] },
        );
        expect(
            parsePermissionsInput(['pin_message', 'pin_message', 'ban_users']),
        ).toEqual({ all: false, keys: ['pin_messages', 'ban_users'] });
    });

    it('rejects non-arrays and unknown keys', () => {
        expect(parsePermissionsInput('ban_users')).toBeNull();
        expect(parsePermissionsInput([1])).toBeNull();
        expect(parsePermissionsInput(['unknown'])).toBeNull();
    });
});

describe('permission summaries', () => {
    it('describes admins only', () => {
        expect(permissionSummary('owner', ['all'])).toBeNull();
        expect(permissionSummary('member', ['all'])).toBeNull();
        expect(permissionSummary('admin', ['all'])).toBe('Full admin');
        expect(permissionSummary('admin', [])).toBe('No permissions');
        expect(permissionSummary('admin', ['ban_users'])).toBe('1 permission');
        expect(permissionSummary('admin', ['ban_users', 'ban_user'])).toBe(
            '1 permission',
        );
    });
});
