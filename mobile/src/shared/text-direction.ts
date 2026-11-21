/**
 * Bidi / display helpers for user-generated text (names, group titles, chat
 * previews).
 *
 * Two independent directions matter here:
 *
 *   - layout direction → `I18nManager.isRTL`; list rows and headers align to
 *     this side so Persian and English rows all sit on the same edge.
 *   - content direction → the first strong character of a name; only text that
 *     opts into `align="content"` (message bodies/quotes) follows it.
 *
 * Android and iOS resolve the base direction of a paragraph differently when
 * it is left to `auto`, especially when the string starts with a digit, an
 * emoji, punctuation or a bidi control character. Resolving the direction here
 * and passing an explicit `writingDirection` + matching `textAlign` gives both
 * platforms the same, stable result.
 */
import { I18nManager } from 'react-native';
import type { TextStyle } from 'react-native';

export type TextDirection = 'ltr' | 'rtl';

/**
 * The app's LAYOUT direction, not the direction of any one string. List rows
 * and headers align to this side so Persian and English rows sit on the same
 * edge; only message bodies opt into content-based alignment.
 */
export function getLayoutDirection(): TextDirection {
    return I18nManager.isRTL ? 'rtl' : 'ltr';
}

/** Arabic, Hebrew, Syriac, Thaana, NKo, Samaritan, Arabic Supplement/Extended. */
const RTL_LETTER =
    /[\u0590-\u05FF\u0600-\u06FF\u0700-\u074F\u0750-\u077F\u07C0-\u07FF\u0800-\u083F\u08A0-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;

/** Any Unicode letter that is not covered by RTL_LETTER is a strong LTR char. */
const ANY_LETTER = /\p{L}/u;

/**
 * Invisible characters that make measurement unpredictable and are never part
 * of a name: BOM, ZERO WIDTH SPACE, LRM/RLM/ALM, the bidi embedding/override
 * controls and the Unicode isolate controls.
 *
 * ZWNJ (U+200C) and ZWJ (U+200D) are intentionally KEPT — they are required
 * for correct Persian/Arabic joining and for emoji sequences. Emoji variation
 * selectors are kept too, so `❤️` still renders as an emoji.
 */
const INVISIBLE_CONTROLS =
    // eslint-disable-next-line no-control-regex -- stripping control characters is the point
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u061C\u200B\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

const ISOLATE_START = '\u2068'; // FSI
const ISOLATE_END = '\u2069'; // PDI

/**
 * Direction of the first strong character; neutral prefixes (digits, emoji,
 * punctuation, spaces) are skipped, exactly like the Unicode bidi algorithm.
 * A string with no strong character is LTR, which matches the app UI.
 */
export function detectTextDirection(text: string): TextDirection {
    for (const character of text) {
        if (RTL_LETTER.test(character)) {
            return 'rtl';
        }
        if (ANY_LETTER.test(character)) {
            return 'ltr';
        }
    }
    return 'ltr';
}

/**
 * Trim and remove invisible bidi/control characters. Safe for names and for
 * multi-line text (line breaks are preserved).
 */
export function normalizeDisplayText(text: string): string {
    return text
        .replace(INVISIBLE_CONTROLS, '')
        .replace(/\r\n?/g, '\n')
        .replace(/[ \t\f\v]+/g, ' ');
}

/**
 * Like `normalizeDisplayText`, but also collapses every whitespace run —
 * including newlines — to one space. Use for single-line names so a pasted
 * multi-line name cannot change a row's height.
 */
export function normalizeSingleLineText(text: string): string {
    return normalizeDisplayText(text).replace(/\s+/g, ' ').trim();
}

/**
 * Wraps a mixed-direction string in Unicode first-strong isolates. The
 * neighbors around the string (badges, timestamps, punctuation) can no longer
 * reorder into it. Keep this OFF by default: apply it to composed sentences
 * (e.g. "Replying to <Persian name>") rather than to every name, because some
 * older Android text engines measure isolates imprecisely.
 */
export function isolateText(text: string): string {
    const trimmed = text.trim();
    if (trimmed === '' || trimmed.startsWith(ISOLATE_START)) {
        return text;
    }
    return `${ISOLATE_START}${text}${ISOLATE_END}`;
}

/**
 * Explicit direction styles for one Text node.
 *
 * `align` lets centered/right-aligned surfaces keep their layout: pass
 * `'center'` for header/profile titles, otherwise the alignment follows the
 * resolved text direction (`rtl` → right, `ltr` → left).
 */
export function textDirectionStyle(
    text: string,
    align: 'auto' | 'center' = 'auto',
): Pick<TextStyle, 'writingDirection' | 'textAlign'> {
    const direction = detectTextDirection(text);
    if (align === 'center') {
        return { writingDirection: direction, textAlign: 'center' };
    }
    return {
        writingDirection: direction,
        textAlign: direction === 'rtl' ? 'right' : 'left',
    };
}
