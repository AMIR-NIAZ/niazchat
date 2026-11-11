import * as Linking from 'expo-linking';

/**
 * Invite-link wire model + pure UI helpers. Ids are numbers on the wire;
 * status is always the server-computed value (never derived from dates here).
 */

export type InviteLinkStatus = 'active' | 'expired' | 'used_up' | 'revoked';

export interface InviteLinkCreatedBy {
    userId: number | null;
    name: string;
}

export interface InviteLinkDto {
    id: number;
    code: string;
    status: InviteLinkStatus;
    createdBy: InviteLinkCreatedBy;
    createdAt: string;
    expiresAt: string | null;
    maxUses: number | null;
    usesCount: number;
    revokedAt: string | null;
}

export interface InviteLinksPage {
    items: InviteLinkDto[];
    activeCount: number;
    maxActive: number;
}

export interface InvitePreview {
    title: string;
    description: string | null;
    avatar: string | null;
    membersCount: number;
    alreadyMember: boolean;
    chatId: number | null;
}

export interface JoinInviteResult {
    chatId: number;
    title: string;
    joined: boolean;
    alreadyMember: boolean;
}

export interface InviteCreateInput {
    expiresInSeconds: number | null;
    maxUses: number | null;
}

export interface InviteChoice<T> {
    label: string;
    value: T;
}

export const MAX_ACTIVE_INVITE_LINKS = 10;
export const INVITE_CODE_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export const INVITE_EXPIRY_CHOICES: readonly InviteChoice<number | null>[] = [
    { label: 'Never', value: null },
    { label: '1 hour', value: 3600 },
    { label: '1 day', value: 86_400 },
    { label: '7 days', value: 604_800 },
    { label: '30 days', value: 2_592_000 },
];

export const INVITE_MAX_USES_CHOICES: readonly InviteChoice<number | null>[] = [
    { label: 'Unlimited', value: null },
    { label: '1', value: 1 },
    { label: '5', value: 5 },
    { label: '10', value: 10 },
    { label: '50', value: 50 },
    { label: '100', value: 100 },
];

export const DEFAULT_INVITE_CREATE_INPUT: InviteCreateInput = {
    expiresInSeconds: null,
    maxUses: null,
};

export function inviteLinksQueryKey(
    chatId: number,
): readonly [string, number, string] {
    return ['group', chatId, 'invite-links'] as const;
}

/** Correct for Expo Go (`exp://…/--/join/<code>`) and dev/production builds. */
export function inviteLinkUrl(code: string): string {
    return Linking.createURL(`join/${code}`);
}

/** True for a well-formed 22-character invite code. */
export function isInviteCode(value: string): boolean {
    return INVITE_CODE_PATTERN.test(value);
}

/** One piece of message text: plain text or a tappable absolute URL. */
export type LinkifiedSegment =
    | { type: 'text'; text: string }
    | { type: 'link'; text: string; url: string };

/**
 * Absolute URLs inside free text. Custom schemes are included because the
 * app's own invite links are `niazchat://join/<code>` (and `exp://…/--/join/…`
 * in Expo Go). Trailing quotes/brackets are excluded so a URL inside
 * parentheses is not swallowed.
 */
const LINK_PATTERN = /(?:https?:\/\/|niazchat:\/\/|exp:\/\/)[^\s<>"'`)\]}]+/gi;

/** Sentence punctuation that commonly follows a pasted URL. */
function trimLinkEnd(value: string): string {
    return value.replace(/[.,;:!?]+$/, '');
}

/**
 * Splits a message body into text and link segments while preserving every
 * character of the original string (spacing, newlines, emoji). Only the URL
 * itself becomes a link; the rest of the message stays plain text.
 */
export function splitLinkifiedText(text: string): LinkifiedSegment[] {
    if (text === '') return [];
    const segments: LinkifiedSegment[] = [];
    let cursor = 0;
    LINK_PATTERN.lastIndex = 0;
    let match = LINK_PATTERN.exec(text);
    while (match !== null) {
        const raw = match[0];
        const url = trimLinkEnd(raw);
        const start = match.index;
        if (start > cursor) {
            segments.push({ type: 'text', text: text.slice(cursor, start) });
        }
        if (url === '') {
            segments.push({ type: 'text', text: raw });
        } else {
            segments.push({ type: 'link', text: url, url });
            const trailing = raw.slice(url.length);
            if (trailing !== '') {
                segments.push({ type: 'text', text: trailing });
            }
        }
        cursor = start + raw.length;
        match = LINK_PATTERN.exec(text);
    }
    if (cursor < text.length) {
        segments.push({ type: 'text', text: text.slice(cursor) });
    }
    return segments;
}

/**
 * Extract the invite code from a NiazChat link without depending on URL
 * parsing quirks across JS engines (Hermes' `URL` is not complete).
 *
 * Accepts the generated formats — `niazchat://join/<code>`,
 * `exp://host:port/--/join/<code>` — and http(s) links that carry the same
 * `/join/<code>` (or `/invite/<code>`) path. The code itself is always
 * validated against the 22-character server format and is re-validated by the
 * backend when previewing/joining, so a forged path can never grant access.
 */
export function inviteCodeFromUrl(raw: string): string | null {
    const text = raw.trim();
    if (text === '') return null;
    const withoutScheme = text.replace(
        /^[A-Za-z][A-Za-z0-9+.-]*:\/\//,
        '',
    );
    const path = withoutScheme.split(/[?#]/)[0] ?? '';
    const parts = path.split('/').filter((part) => part !== '');
    const marker = parts.findIndex((part) => {
        const lower = part.toLowerCase();
        return lower === 'join' || lower === 'invite';
    });
    if (marker < 0) return null;
    const candidate = parts[marker + 1];
    return candidate !== undefined && isInviteCode(candidate)
        ? candidate
        : null;
}

/**
 * Accepts a bare 22-character code OR a full invite link with a trailing
 * slash, query string or surrounding text. Returns the code or null.
 */
export function parseInviteInput(raw: string): string | null {
    const text = raw.trim();
    if (text === '') return null;
    if (INVITE_CODE_PATTERN.test(text)) return text;

    const pattern =
        /(^|[^A-Za-z0-9_-])([A-Za-z0-9_-]{22})(?=$|[^A-Za-z0-9_-])/g;
    let match: RegExpExecArray | null = pattern.exec(text);
    while (match !== null) {
        const candidate = match[2];
        if (candidate !== undefined && INVITE_CODE_PATTERN.test(candidate)) {
            return candidate;
        }
        match = pattern.exec(text);
    }
    return null;
}

export function inviteStatusLabel(status: InviteLinkStatus): string {
    switch (status) {
        case 'active':
            return 'Active';
        case 'expired':
            return 'Expired';
        case 'used_up':
            return 'Used up';
        case 'revoked':
            return 'Revoked';
    }
}

function plural(count: number, singular: string): string {
    return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

function formatDistance(ms: number): string {
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) return 'less than a minute';
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return plural(minutes, 'minute');
    const hours = Math.round(minutes / 60);
    if (hours < 24) return plural(hours, 'hour');
    const days = Math.round(hours / 24);
    if (days < 30) return plural(days, 'day');
    const months = Math.round(days / 30);
    if (months < 12) return plural(months, 'month');
    return plural(Math.round(months / 12), 'year');
}

/** `in 3 minutes` / `2 days ago` / `just now`; empty for an invalid date. */
export function relativeTimeLabel(
    iso: string,
    now: number = Date.now(),
): string {
    const time = Date.parse(iso);
    if (!Number.isFinite(time)) return '';
    const diff = time - now;
    if (Math.abs(diff) < 45_000) return 'just now';
    return diff > 0
        ? `in ${formatDistance(diff)}`
        : `${formatDistance(-diff)} ago`;
}

export function inviteExpiryLabel(
    expiresAt: string | null,
    now: number = Date.now(),
): string {
    if (expiresAt === null) return 'Never';
    const time = Date.parse(expiresAt);
    if (!Number.isFinite(time)) return 'Never';
    if (time <= now) return 'Expired';
    return `Expires ${relativeTimeLabel(expiresAt, now)}`;
}

export function inviteUsesLabel(link: InviteLinkDto): string {
    return link.maxUses === null
        ? `${link.usesCount} joined`
        : `${link.usesCount} / ${link.maxUses} used`;
}

export function inviteCreatedByLabel(
    link: InviteLinkDto,
    now: number = Date.now(),
): string {
    const name = link.createdBy.name.trim() || 'Unknown';
    return `Created by ${name} · ${relativeTimeLabel(link.createdAt, now)}`;
}

export function splitInviteLinks(items: readonly InviteLinkDto[]): {
    active: InviteLinkDto[];
    inactive: InviteLinkDto[];
} {
    return {
        active: items.filter((item) => item.status === 'active'),
        inactive: items.filter((item) => item.status !== 'active'),
    };
}

/** Share text: link first, bare code on the second line for manual entry. */
export function inviteShareMessage(title: string, code: string): string {
    const groupTitle = title.trim() || 'this group';
    return `Join "${groupTitle}" on niazchat: ${inviteLinkUrl(code)}\n${code}`;
}
