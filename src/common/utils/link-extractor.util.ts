/**
 * URL extraction for the chat "shared content → links" tab.
 *
 * Links are stored at write time in `message_links` so the tab is a cheap
 * indexed query instead of a regex scan over every message body. The same
 * helper is used by:
 *   - `MessageService.create` / `edit` (live messages),
 *   - `MessageForwardService` (forwarded links),
 *   - the one-time backfill script (`npm run backfill:links`).
 *
 * Detection is intentionally conservative and aligned with
 * `messageContainsLink()` (the group `send_links` permission): explicit
 * `http(s)://`, `www.` and bare hosts with a known TLD. A bare match must look
 * like a real host, so `report.pdf` or `e.g.` are not stored as links.
 */

/** One distinct URL found in a message body. */
export interface ExtractedLink {
    /** Absolute URL (`https://` is added when the text had no scheme). */
    url: string;
    /** Lowercase hostname without a leading `www.`. */
    domain: string;
}

/** Longest URL we store; the column is varchar(2048). */
export const MAX_LINK_URL_LENGTH = 2048;

/**
 * Matches, in order of preference:
 *   1. `http://…` / `https://…`
 *   2. `www.example.com/…`
 *   3. a bare `sub.example.tld/…` with one of the known TLDs below
 *
 * Trailing punctuation is stripped afterwards, so a URL inside a sentence
 * (`see https://example.com/x).`) does not keep the closing bracket.
 */
const LINK_PATTERN =
    /(?:https?:\/\/|www\.)[^\s<>"'`]+|\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|io|me|ir|co|dev|app|link|xyz|info|edu|gov|ly|to|gg|tv|site|online)\b(?:\/[^\s<>"'`]*)?/gi;

/** Sentence punctuation that often follows a URL but is not part of it. */
const TRAILING_PUNCTUATION = /[.,;:!?،؛»”’"'\])}]+$/;

/** Leading punctuation accidentally captured by the bare-host branch. */
const LEADING_PUNCTUATION = /^[([{«“‘"']+/;

function cleanCandidate(raw: string): string {
    let value = raw.trim();
    let previous = '';
    // Repeat: `https://example.com/x)).` may need more than one pass.
    while (value !== previous) {
        previous = value;
        value = value
            .replace(TRAILING_PUNCTUATION, '')
            .replace(LEADING_PUNCTUATION, '');
    }
    return value;
}

/**
 * Absolute URL + display domain for one candidate, or `null` when it is not a
 * usable http(s) link (e.g. an email-like string or an oversized URL).
 */
export function normalizeLink(raw: string): ExtractedLink | null {
    const candidate = cleanCandidate(raw);
    if (candidate === '') return null;
    // `mailto:test@example.com` parses as userinfo + host by WHATWG URL, which
    // is not a chat link. Rejecting `@` also keeps email addresses out.
    if (candidate.includes('@')) return null;

    const withScheme = /^https?:\/\//i.test(candidate)
        ? candidate
        : `https://${candidate.replace(/^\/+/u, '')}`;

    let parsed: URL;
    try {
        parsed = new URL(withScheme);
    } catch {
        return null;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return null;
    }
    const domain = parsed.hostname
        .replace(/^www\./i, '')
        .toLowerCase()
        .replace(/\.$/, '');
    if (domain === '' || !domain.includes('.')) {
        return null;
    }
    if (withScheme.length > MAX_LINK_URL_LENGTH) {
        return null;
    }
    return { url: withScheme, domain };
}

/**
 * Every distinct link of a message body, in first-seen order.
 *
 * De-duplication is by full URL. Links that only differ in trailing
 * punctuation collapse to one entry.
 */
export function extractLinks(
    content: string | null | undefined,
): ExtractedLink[] {
    if (typeof content !== 'string' || content.trim() === '') {
        return [];
    }
    const links: ExtractedLink[] = [];
    const seen = new Set<string>();
    // `matchAll` needs the global flag; the shared pattern is cloned per call.
    const pattern = new RegExp(LINK_PATTERN.source, LINK_PATTERN.flags);
    for (const match of content.matchAll(pattern)) {
        const normalized = normalizeLink(match[0]);
        if (normalized === null || seen.has(normalized.url)) {
            continue;
        }
        seen.add(normalized.url);
        links.push(normalized);
    }
    return links;
}

/**
 * Short text around the link for the Links row (the message body is not
 * returned in full). Falls back to the whole body when the domain cannot be
 * located (the stored URL may have been normalized).
 */
export function linkSnippet(
    content: string | null | undefined,
    domain: string,
    maxLength = 140,
): string {
    const text = (content ?? '').replace(/\s+/g, ' ').trim();
    if (text.length <= maxLength) return text;

    const index = text.toLowerCase().indexOf(domain.toLowerCase());
    const start =
        index === -1
            ? 0
            : Math.max(0, index - Math.floor((maxLength - domain.length) / 2));
    const end = Math.min(text.length, start + maxLength);
    const slice = text.slice(start, end).trim();
    return `${start > 0 ? '…' : ''}${slice}${end < text.length ? '…' : ''}`;
}
