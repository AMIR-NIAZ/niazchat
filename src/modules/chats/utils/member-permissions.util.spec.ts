import {
    DEFAULT_MEMBER_PERMISSIONS,
    MEMBER_PERMISSIONS,
    MEMBER_PERMISSION_META,
    MEMBER_PERMISSION_SECTIONS,
    attachmentMemberPermission,
    isMemberPermission,
    memberPermissionsChanged,
    mergeMemberPermissions,
    messageContainsLink,
    normalizeMemberPermissions,
    normalizeMemberPermissionOverrides,
    parseMemberPermissionsPatch,
    parseMemberPermissionOverridesPatch,
    isEmptyMemberPermissionOverrides,
    memberPermissionOverridesChanged,
    resolveMemberPermissions,
    storedMemberPermissionOverrides,
} from './member-permissions.util';

describe('member permissions contract', () => {
    it('defines the ten independent permissions with defaults', () => {
        expect(MEMBER_PERMISSIONS).toHaveLength(10);
        expect(DEFAULT_MEMBER_PERMISSIONS).toMatchObject({
            send_messages: true,
            send_media: true,
            send_files: true,
            send_voice: true,
            send_links: true,
            add_members: false,
            invite_via_link: true,
            pin_messages: false,
            edit_own_messages: true,
            delete_own_messages: true,
        });
        expect(Object.keys(MEMBER_PERMISSION_META).sort()).toEqual(
            [...MEMBER_PERMISSIONS].sort(),
        );
    });

    it('covers every permission exactly once in the editor sections', () => {
        const keys = MEMBER_PERMISSION_SECTIONS.flatMap(
            (section) => section.permissions,
        );
        expect([...keys].sort()).toEqual([...MEMBER_PERMISSIONS].sort());
        expect(new Set(keys).size).toBe(keys.length);
    });

    describe('normalizeMemberPermissions', () => {
        it('fills missing and malformed values from the defaults', () => {
            expect(
                normalizeMemberPermissions({
                    send_messages: false,
                    invite_via_link: 'yes',
                    unknown_key: true,
                }),
            ).toEqual({
                ...DEFAULT_MEMBER_PERMISSIONS,
                send_messages: false,
            });
        });

        it('returns the defaults for null / non-object stored values', () => {
            expect(normalizeMemberPermissions(null)).toEqual({
                ...DEFAULT_MEMBER_PERMISSIONS,
            });
            expect(normalizeMemberPermissions('nope')).toEqual({
                ...DEFAULT_MEMBER_PERMISSIONS,
            });
        });
    });

    describe('parseMemberPermissionsPatch', () => {
        it('accepts known boolean keys (partial)', () => {
            expect(
                parseMemberPermissionsPatch({
                    pin_messages: true,
                    send_links: false,
                }),
            ).toEqual({ pin_messages: true, send_links: false });
        });

        it('rejects unknown keys', () => {
            expect(
                parseMemberPermissionsPatch({ send_messages: true, nope: 1 }),
            ).toBeNull();
        });

        it('rejects non-boolean values', () => {
            expect(
                parseMemberPermissionsPatch({ send_messages: 'true' }),
            ).toBeNull();
            expect(
                parseMemberPermissionsPatch({ send_messages: 1 }),
            ).toBeNull();
        });

        it('rejects empty and non-object payloads', () => {
            expect(parseMemberPermissionsPatch({})).toBeNull();
            expect(parseMemberPermissionsPatch(null)).toBeNull();
            expect(parseMemberPermissionsPatch([])).toBeNull();
            expect(parseMemberPermissionsPatch('x')).toBeNull();
        });
    });

    it('detects real changes and merges field-wise', () => {
        const current = { ...DEFAULT_MEMBER_PERMISSIONS };
        expect(memberPermissionsChanged(current, { add_members: false })).toBe(
            false,
        );
        expect(memberPermissionsChanged(current, { add_members: true })).toBe(
            true,
        );
        expect(
            mergeMemberPermissions(current, {
                add_members: true,
                pin_messages: true,
            }),
        ).toEqual({
            ...current,
            add_members: true,
            pin_messages: true,
        });
    });

    it('maps attachment kinds to the matching permission', () => {
        expect(attachmentMemberPermission('image')).toBe('send_media');
        expect(attachmentMemberPermission('video')).toBe('send_media');
        expect(attachmentMemberPermission('voice')).toBe('send_voice');
        expect(attachmentMemberPermission('file')).toBe('send_files');
        expect(attachmentMemberPermission('music')).toBe('send_files');
    });

    it('detects links conservatively', () => {
        expect(messageContainsLink('hello')).toBe(false);
        expect(messageContainsLink('')).toBe(false);
        expect(messageContainsLink('https://example.com/x')).toBe(true);
        expect(messageContainsLink('www.example.com')).toBe(true);
        expect(messageContainsLink('example.com/path')).toBe(true);
        expect(messageContainsLink('example.ir')).toBe(true);
    });

    it('guards contract keys', () => {
        expect(isMemberPermission('send_messages')).toBe(true);
        expect(isMemberPermission('manage_permissions')).toBe(false);
        expect(isMemberPermission(1)).toBe(false);
    });
});

describe('member permission overrides', () => {
    it('inherits the group default, then applies allow and deny', () => {
        const defaults = { ...DEFAULT_MEMBER_PERMISSIONS };
        const inherited = normalizeMemberPermissionOverrides({});
        expect(resolveMemberPermissions(defaults, inherited)).toEqual(defaults);

        const denied = normalizeMemberPermissionOverrides({
            send_files: 'deny',
        });
        expect(resolveMemberPermissions(defaults, denied).send_files).toBe(
            false,
        );
        expect(resolveMemberPermissions(defaults, denied).send_media).toBe(
            true,
        );

        const allowed = normalizeMemberPermissionOverrides({
            add_members: 'allow',
        });
        expect(resolveMemberPermissions(defaults, allowed).add_members).toBe(
            true,
        );
    });

    it('normalizes unknown states and keys to inherit', () => {
        expect(
            normalizeMemberPermissionOverrides({
                send_files: 'deny',
                send_media: 'maybe',
                nope: 'allow',
            }),
        ).toEqual({
            ...normalizeMemberPermissionOverrides({}),
            send_files: 'deny',
        });
    });

    it('stores only explicit allow/deny keys', () => {
        const map = normalizeMemberPermissionOverrides({
            send_files: 'deny',
            send_links: 'inherit',
            pin_messages: 'allow',
        });
        expect(storedMemberPermissionOverrides(map)).toEqual({
            send_files: 'deny',
            pin_messages: 'allow',
        });
        expect(isEmptyMemberPermissionOverrides(map)).toBe(false);
        expect(
            isEmptyMemberPermissionOverrides(
                normalizeMemberPermissionOverrides({}),
            ),
        ).toBe(true);
    });

    it('validates tri-state patches', () => {
        expect(parseMemberPermissionOverridesPatch({})).toBeNull();
        expect(
            parseMemberPermissionOverridesPatch({ send_files: 'maybe' }),
        ).toBeNull();
        expect(
            parseMemberPermissionOverridesPatch({ unknown: 'allow' }),
        ).toBeNull();
        expect(
            parseMemberPermissionOverridesPatch({ send_files: 'deny' }),
        ).toEqual({ send_files: 'deny' });
    });

    it('detects changed fields and merges field-wise', () => {
        const current = normalizeMemberPermissionOverrides({
            send_files: 'deny',
        });
        expect(
            memberPermissionOverridesChanged(current, {
                send_files: 'deny',
            }),
        ).toBe(false);
        expect(
            memberPermissionOverridesChanged(current, {
                send_files: 'allow',
            }),
        ).toBe(true);
    });
});
