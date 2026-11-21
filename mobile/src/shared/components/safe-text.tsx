import { StyleSheet, Text } from 'react-native';
import type { ReactNode } from 'react';
import type { TextProps, TextStyle } from 'react-native';
import { typography } from '../theme';
import {
    detectTextDirection,
    getLayoutDirection,
    isolateText,
    normalizeDisplayText,
    normalizeSingleLineText,
} from '../text-direction';

/**
 * Text for user-generated content (names, group titles, chat rows, sender
 * names, search results).
 *
 * It is a normal `<Text>` with four safety defaults:
 *
 * 1. **Layout-side alignment by default** — `textAlign` follows the app's
 *    layout direction (`I18nManager.isRTL`), not the first strong character
 *    of the string. A Persian name and an English name in the same list sit
 *    on the same side. `writingDirection` also follows the layout direction
 *    so neutral characters cannot reorder between rows. Pass
 *    `align="content"` for text whose own direction must win (message
 *    bodies, quotes) or `align="center"` for centered titles. A caller
 *    provided `textAlign`/`writingDirection` in `style` always wins.
 * 2. **Shrinkable** — `flexShrink: 1` + `minWidth: 0`, so a long name inside
 *    a `flexDirection: 'row'` cannot push the avatar/timestamp/badge out.
 * 3. **Single line by default** — `numberOfLines={1}` +
 *    `ellipsizeMode="tail"`. Pass `lines={2}` (or higher) for multi-line
 *    titles; pass `lines={0}` for unlimited text.
 * 4. **Normalized** — bidi control characters are stripped and whitespace is
 *    cleaned. Single-line text also collapses newlines. ZWNJ/ZWJ and emoji
 *    variation selectors are preserved.
 *
 * The parent row still owns the layout: give the name container `flex: 1` (or
 * `flexShrink: 1` + `minWidth: 0`) and fixed sizes for avatar/time/badge.
 */
export type SafeTextAlign = 'layout' | 'content' | 'center';

export interface SafeTextProps extends TextProps {
    /** Typography token; omit to inherit from the surrounding style. */
    variant?: keyof typeof typography;
    /**
     * How the block is aligned. `layout` (default) follows the app's layout
     * direction, `content` follows the string's own first strong character,
     * `center` centers the block. Alignment never depends on the string in
     * the default mode.
     */
    align?: SafeTextAlign;
    /**
     * Maximum lines. Defaults to 1 (names). `0` removes the limit (long
     * descriptions/messages).
     */
    lines?: number;
    /** Adds `flexShrink: 1` and `minWidth: 0`. Defaults to true. */
    shrink?: boolean;
    /**
     * Wrap the string in Unicode isolates so mixed parts cannot reorder
     * neighboring content. Useful for composed sentences, not every name.
     */
    isolate?: boolean;
    /** Trim/strip invisible characters. Defaults to true. */
    normalize?: boolean;
}

function contentAsText(children: ReactNode): string | null {
    if (typeof children === 'string') {
        return children;
    }
    if (typeof children === 'number') {
        return String(children);
    }
    if (Array.isArray(children)) {
        const parts: string[] = [];
        for (const child of children) {
            if (typeof child === 'string') {
                parts.push(child);
            } else if (typeof child === 'number') {
                parts.push(String(child));
            } else if (
                child !== null &&
                child !== undefined &&
                child !== false
            ) {
                // Nested elements cannot be normalized without editing the
                // tree; fall back to the caller's children untouched.
                return null;
            }
        }
        return parts.join('');
    }
    return null;
}

export function SafeText({
    variant,
    align = 'layout',
    lines = 1,
    shrink = true,
    isolate = false,
    normalize = true,
    style,
    children,
    ellipsizeMode = 'tail',
    textBreakStrategy,
    ...rest
}: SafeTextProps): React.ReactElement {
    const raw = contentAsText(children);
    const singleLine = lines === 1;

    let content: ReactNode = children;
    let directionSource = raw ?? '';
    if (raw !== null) {
        const normalized = normalize
            ? singleLine
                ? normalizeSingleLineText(raw)
                : normalizeDisplayText(raw)
            : raw;
        directionSource = normalized;
        content = isolate ? isolateText(normalized) : normalized;
    }

    const flat = (StyleSheet.flatten(style) ?? {}) as TextStyle;
    const layoutDirection = getLayoutDirection();
    // The STRING's direction is only used by opt-in `content` alignment; the
    // default block side always comes from the app layout.
    const contentDirection = detectTextDirection(directionSource);
    const direction = align === 'content' ? contentDirection : layoutDirection;
    const hasExplicitAlign = flat.textAlign !== undefined;
    const hasExplicitWritingDirection = flat.writingDirection !== undefined;
    const textAlign: TextStyle['textAlign'] =
        align === 'center'
            ? 'center'
            : align === 'content'
              ? contentDirection === 'rtl'
                  ? 'right'
                  : 'left'
              : layoutDirection === 'rtl'
                ? 'right'
                : 'left';

    const directionStyle: TextStyle = {
        ...(hasExplicitWritingDirection ? {} : { writingDirection: direction }),
        ...(hasExplicitAlign ? {} : { textAlign }),
    };
    const layoutStyle: TextStyle = shrink ? { flexShrink: 1, minWidth: 0 } : {};
    const lineProps = lines > 0 ? { numberOfLines: lines, ellipsizeMode } : {};

    return (
        <Text
            style={[
                variant !== undefined ? typography[variant] : null,
                layoutStyle,
                directionStyle,
                style,
            ]}
            {...lineProps}
            {...(textBreakStrategy !== undefined
                ? { textBreakStrategy }
                : lines > 1
                  ? { textBreakStrategy: 'simple' as const }
                  : {})}
            {...rest}
        >
            {content}
        </Text>
    );
}
