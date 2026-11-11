import { randomBytes } from 'crypto';

/** 16 random bytes encoded base64url: 22 characters, no padding. */
export const INVITE_CODE_LENGTH = 22;
export const INVITE_CODE_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export const MAX_ACTIVE_INVITE_LINKS = 10;
export const INACTIVE_INVITE_LINKS_LIMIT = 20;

export const INVITE_EXPIRY_OPTIONS = [
    3600, 86_400, 604_800, 2_592_000,
] as const;
export const INVITE_MAX_USES_OPTIONS = [1, 5, 10, 50, 100] as const;

export const INVITE_INVALID_MESSAGE =
    'This invite link is invalid or has expired';
export const INVITE_BANNED_MESSAGE = "You can't join this group";
export const INVITE_GROUP_ONLY_MESSAGE =
    'This action is only available in groups';
export const INVITE_FORBIDDEN_MESSAGE = "You don't have permission to do this";

export type InviteLinkStatus = 'active' | 'expired' | 'used_up' | 'revoked';

export interface InviteLinkState {
    isActive: boolean;
    expiresAt: Date | string | null;
    maxUses: number | null;
    usesCount: number;
    revokedAt: Date | string | null;
}

/** Server-generated, unguessable, URL-safe code. */
export function generateInviteCode(): string {
    return randomBytes(16).toString('base64url');
}

export function isInviteCode(value: unknown): value is string {
    return typeof value === 'string' && INVITE_CODE_PATTERN.test(value);
}

function asTime(value: Date | string | null): number | null {
    if (value === null) return null;
    const time = value instanceof Date ? value.getTime() : Date.parse(value);
    return Number.isFinite(time) ? time : null;
}

/**
 * Status from the server clock. Revoked wins over every other state, then
 * expiry, then the usage limit; only a link passing all checks is active.
 */
export function computeInviteStatus(
    link: InviteLinkState,
    now: Date,
): InviteLinkStatus {
    if (link.revokedAt !== null || link.isActive === false) {
        return 'revoked';
    }
    const expiresAt = asTime(link.expiresAt);
    if (expiresAt !== null && expiresAt <= now.getTime()) {
        return 'expired';
    }
    if (link.maxUses !== null && link.usesCount >= link.maxUses) {
        return 'used_up';
    }
    return 'active';
}

export function isInviteUsable(link: InviteLinkState, now: Date): boolean {
    return computeInviteStatus(link, now) === 'active';
}

export function isAllowedExpiry(value: unknown): boolean {
    return (
        value === null ||
        (typeof value === 'number' &&
            (INVITE_EXPIRY_OPTIONS as readonly number[]).includes(value))
    );
}

export function isAllowedMaxUses(value: unknown): boolean {
    return (
        value === null ||
        (typeof value === 'number' &&
            (INVITE_MAX_USES_OPTIONS as readonly number[]).includes(value))
    );
}

/** Postgres unique-index violation (code 23505), including the driver error. */
export function isUniqueViolation(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return false;
    const candidate = error as {
        code?: unknown;
        driverError?: { code?: unknown };
    };
    return (
        candidate.code === '23505' || candidate.driverError?.code === '23505'
    );
}
