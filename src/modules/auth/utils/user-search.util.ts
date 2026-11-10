import { BadRequestException } from '@nestjs/common';

export const USER_SEARCH_MAX_LIMIT = 20;
export const USER_SEARCH_RATE_LIMIT = 30;
export const USER_SEARCH_RATE_WINDOW_SECONDS = 60;

/**
 * Username search normalization: trim, strip ONE leading `@`, lowercase.
 * A query shorter than 2 characters is rejected (400) so prefix search cannot
 * be used to enumerate single-letter accounts.
 */
export function normalizeUserSearch(raw: unknown): string {
    const text = typeof raw === 'string' ? raw.trim() : '';
    const withoutAt = text.startsWith('@') ? text.slice(1).trim() : text;
    if (withoutAt.length < 2) {
        throw new BadRequestException(
            'search query must be at least 2 characters',
        );
    }
    return withoutAt.toLowerCase();
}

/** Escapes LIKE wildcards so `%`, `_` and `\` match literally. */
export function escapeLikePattern(value: string): string {
    return value
        .replace(/\\/g, '\\\\')
        .replace(/%/g, '\\%')
        .replace(/_/g, '\\_');
}

/** `limit` defaults to 20 and is capped at 20. */
export function normalizeSearchLimit(raw: unknown): number {
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 1) {
        return USER_SEARCH_MAX_LIMIT;
    }
    return Math.min(parsed, USER_SEARCH_MAX_LIMIT);
}

/** Rate-limit key for the current minute window. */
export function userSearchRateKey(userId: number): string {
    const bucket = Math.floor(Date.now() / 60_000);
    return `user:search:${userId}:${bucket}`;
}
