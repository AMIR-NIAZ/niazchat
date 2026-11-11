import {
    computeInviteStatus,
    generateInviteCode,
    INVITE_CODE_PATTERN,
    isAllowedExpiry,
    isAllowedMaxUses,
    isInviteCode,
    isUniqueViolation,
    type InviteLinkState,
} from './invite-link.util';

const NOW = new Date('2026-01-01T12:00:00.000Z');

function state(overrides: Partial<InviteLinkState> = {}): InviteLinkState {
    return {
        isActive: true,
        expiresAt: null,
        maxUses: null,
        usesCount: 0,
        revokedAt: null,
        ...overrides,
    };
}

describe('generateInviteCode', () => {
    it('is 22 URL-safe characters', () => {
        for (let index = 0; index < 100; index += 1) {
            const code = generateInviteCode();
            expect(code).toHaveLength(22);
            expect(INVITE_CODE_PATTERN.test(code)).toBe(true);
            expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
        }
    });

    it('does not repeat', () => {
        const codes = new Set(
            Array.from({ length: 200 }, () => generateInviteCode()),
        );
        expect(codes.size).toBe(200);
    });
});

describe('isInviteCode', () => {
    it('accepts exactly 22 code characters and rejects everything else', () => {
        expect(isInviteCode('A'.repeat(22))).toBe(true);
        expect(isInviteCode('a_b-C9'.padEnd(22, 'x'))).toBe(true);
        expect(isInviteCode('A'.repeat(21))).toBe(false);
        expect(isInviteCode('A'.repeat(23))).toBe(false);
        expect(isInviteCode('deadbeef'.repeat(4))).toBe(false);
        expect(isInviteCode('A'.repeat(21) + '!')).toBe(false);
        expect(isInviteCode(' '.repeat(22))).toBe(false);
        expect(isInviteCode(null)).toBe(false);
    });
});

describe('computeInviteStatus', () => {
    it('is active with no expiry and no usage limit', () => {
        expect(computeInviteStatus(state(), NOW)).toBe('active');
    });

    it('is active when uses remain and expiry is in the future', () => {
        expect(
            computeInviteStatus(
                state({
                    usesCount: 2,
                    maxUses: 5,
                    expiresAt: new Date(NOW.getTime() + 60_000),
                }),
                NOW,
            ),
        ).toBe('active');
    });

    it('is expired at or after expiresAt', () => {
        expect(
            computeInviteStatus(state({ expiresAt: NOW }), NOW),
        ).toBe('expired');
        expect(
            computeInviteStatus(
                state({ expiresAt: new Date(NOW.getTime() - 1) }),
                NOW,
            ),
        ).toBe('expired');
        expect(
            computeInviteStatus(
                state({ expiresAt: new Date(NOW.getTime() + 1) }),
                NOW,
            ),
        ).toBe('active');
    });

    it('is used up once usesCount reaches maxUses', () => {
        expect(
            computeInviteStatus(state({ usesCount: 3, maxUses: 3 }), NOW),
        ).toBe('used_up');
        expect(
            computeInviteStatus(state({ usesCount: 4, maxUses: 3 }), NOW),
        ).toBe('used_up');
        expect(
            computeInviteStatus(state({ usesCount: 2, maxUses: 3 }), NOW),
        ).toBe('active');
    });

    it('is revoked when revokedAt is set or the legacy active flag is false', () => {
        expect(
            computeInviteStatus(state({ revokedAt: NOW }), NOW),
        ).toBe('revoked');
        expect(computeInviteStatus(state({ isActive: false }), NOW)).toBe(
            'revoked',
        );
        // Revoked wins over expiry and usage.
        expect(
            computeInviteStatus(
                state({
                    revokedAt: NOW,
                    expiresAt: new Date(NOW.getTime() - 1000),
                    usesCount: 9,
                    maxUses: 1,
                }),
                NOW,
            ),
        ).toBe('revoked');
    });

    it('accepts ISO strings from the driver', () => {
        expect(
            computeInviteStatus(
                state({ expiresAt: '2026-01-01T11:59:59.000Z' }),
                NOW,
            ),
        ).toBe('expired');
    });
});

describe('allowlists', () => {
    it('accepts only the documented expiries and null', () => {
        for (const value of [
            3600, 86_400, 604_800, 2_592_000, null,
        ]) {
            expect(isAllowedExpiry(value)).toBe(true);
        }
        for (const value of [1, 7200, 0, -1, '3600', undefined]) {
            expect(isAllowedExpiry(value)).toBe(false);
        }
    });

    it('accepts only the documented usage limits and null', () => {
        for (const value of [1, 5, 10, 50, 100, null]) {
            expect(isAllowedMaxUses(value)).toBe(true);
        }
        for (const value of [0, 2, 11, 1000, '5', undefined]) {
            expect(isAllowedMaxUses(value)).toBe(false);
        }
    });
});

describe('isUniqueViolation', () => {
    it('detects the Postgres 23505 code in both shapes', () => {
        expect(isUniqueViolation({ code: '23505' })).toBe(true);
        expect(isUniqueViolation({ driverError: { code: '23505' } })).toBe(
            true,
        );
        expect(isUniqueViolation({ code: '23503' })).toBe(false);
        expect(isUniqueViolation(new Error('nope'))).toBe(false);
        expect(isUniqueViolation(null)).toBe(false);
    });
});
