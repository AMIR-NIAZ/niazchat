/**
 * @mention parsing for message bodies.
 *
 * Mirrors the backend username rules (UpdateUserDto):
 *   - 5 to 32 characters
 *   - starts with an ASCII letter
 *   - letters, digits and `_` in the middle
 *   - ends with a letter or digit
 *
 * The mention must start the text or follow a non-word character, so emails
 * (`a@b.com`) and words containing `@` (`foo@bar`) never become mentions.
 * The username is kept exactly as typed: the backend compares usernames
 * case-sensitively (`GET /user/pv/:userName`).
 */

export type MentionSegment =
    | { type: 'text'; text: string }
    | { type: 'mention'; text: string; username: string };

/** Same charset as the backend; the lookahead stops partial matches. */
const MENTION_PATTERN =
    /@([A-Za-z][A-Za-z0-9_]{3,30}[A-Za-z0-9])(?![A-Za-z0-9_])/g;

/** Letters/digits of any script, plus `_`: a mention cannot start there. */
const WORD_CHARACTER = /[\p{L}\p{N}_]/u;

/**
 * Splits text into plain and mention segments, preserving every character of
 * the original string (spacing, punctuation, newlines, emoji).
 */
export function parseMentions(text: string): MentionSegment[] {
    if (text === '') {
        return [];
    }

    const segments: MentionSegment[] = [];
    let cursor = 0;
    MENTION_PATTERN.lastIndex = 0;
    let match = MENTION_PATTERN.exec(text);

    while (match !== null) {
        const raw = match[0];
        const username = match[1] ?? '';
        const start = match.index;
        const before = start > 0 ? (text[start - 1] ?? '') : '';

        // Middle of a word or an email address: leave the whole thing plain.
        if (before !== '' && (before === '@' || WORD_CHARACTER.test(before))) {
            match = MENTION_PATTERN.exec(text);
            continue;
        }

        if (start > cursor) {
            segments.push({ type: 'text', text: text.slice(cursor, start) });
        }
        segments.push({ type: 'mention', text: raw, username });
        cursor = start + raw.length;
        match = MENTION_PATTERN.exec(text);
    }

    if (cursor < text.length) {
        segments.push({ type: 'text', text: text.slice(cursor) });
    }
    return segments;
}
