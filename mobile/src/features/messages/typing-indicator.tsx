import { useEffect, useRef, useState } from 'react';
import {
    AccessibilityInfo,
    Animated,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import {
    MAX_FONT_SCALE,
    palette,
    spacing,
    typography,
} from '../../shared/theme';
import { getLayoutDirection } from '../../shared/text-direction';
import { useTheme, useThemedStyles } from '../../shared/theme';
import type { AppTheme } from '../../shared/theme';
import { AppText } from '../../shared/components';

/**
 * Group-chat header subtitle: "N members" normally, an animated "… is typing"
 * line while someone types. The switch fades, and a shown typing line stays for
 * at least 600 ms so a start/stop pair cannot flash.
 */

const MIN_TYPING_VISIBLE_MS = 600;
const FADE_MS = 90;

/** 1 → "A is typing"; 2 → "A and B are typing"; 3+ → "A, B and N others…". */
export function formatTypingText(names: string[]): string | null {
    const clean = names.map(
        (name) => (typeof name === 'string' ? name.trim() : '') || 'Someone',
    );
    if (clean.length === 0) {
        return null;
    }
    if (clean.length === 1) {
        return `${clean[0]} is typing`;
    }
    if (clean.length === 2) {
        return `${clean[0]} and ${clean[1]} are typing`;
    }
    const others = clean.length - 2;
    return `${clean[0]}, ${clean[1]} and ${others} other${
        others === 1 ? '' : 's'
    } are typing`;
}

function useReduceMotion(): boolean {
    const [enabled, setEnabled] = useState(false);

    useEffect((): (() => void) => {
        let active = true;
        void AccessibilityInfo.isReduceMotionEnabled()
            .then((value) => {
                if (active) {
                    setEnabled(value);
                }
            })
            .catch(() => undefined);
        const subscription = AccessibilityInfo.addEventListener(
            'reduceMotionChanged',
            setEnabled,
        );
        return (): void => {
            active = false;
            subscription.remove();
        };
    }, []);

    return enabled;
}

function TypingDots(): React.ReactElement {
    const styles = useThemedStyles(createStyles);
    const reduceMotion = useReduceMotion();
    const values = useRef([
        new Animated.Value(0.3),
        new Animated.Value(0.3),
        new Animated.Value(0.3),
    ]).current;

    useEffect((): (() => void) | undefined => {
        if (reduceMotion) {
            values.forEach((value) => value.setValue(1));
            return undefined;
        }
        const loops = values.map((value, index) =>
            Animated.loop(
                Animated.sequence([
                    Animated.delay(index * 140),
                    Animated.timing(value, {
                        toValue: 1,
                        duration: 180,
                        useNativeDriver: true,
                    }),
                    Animated.timing(value, {
                        toValue: 0.3,
                        duration: 180,
                        useNativeDriver: true,
                    }),
                    Animated.delay((2 - index) * 140),
                ]),
            ),
        );
        loops.forEach((loop) => loop.start());
        return (): void => {
            loops.forEach((loop) => loop.stop());
        };
    }, [reduceMotion, values]);

    if (reduceMotion) {
        return <AppText style={styles.dots}>…</AppText>;
    }

    return (
        <View style={styles.dotsRow}>
            {values.map((value, index) => (
                <Animated.Text
                    key={index}
                    style={[
                        styles.dot,
                        {
                            opacity: value,
                            transform: [
                                {
                                    translateY: value.interpolate({
                                        inputRange: [0.3, 1],
                                        outputRange: [0, -1.5],
                                    }),
                                },
                            ],
                        },
                    ]}
                >
                    •
                </Animated.Text>
            ))}
        </View>
    );
}

export function GroupChatSubtitle(props: {
    names: string[];
    membersCount: number | null;
    suffix?: string;
    /** Private chats: show the animated dots without naming the person. */
    typing?: boolean;
    /** Private chats: label shown while typing instead of "X is typing". */
    typingLabel?: string;
    /** Private chats: base line when there is no member count (presence). */
    fallbackText?: string;
    /**
     * `layout` (default) follows the app's layout direction, so the subtitle
     * stays on the same edge as the names in the header. `center` centers it
     * for the chat header's centered title block.
     */
    align?: 'layout' | 'center';
}): React.ReactElement {
    const theme = useTheme();
    const styles = useThemedStyles(createStyles);
    const centered = (props.align ?? 'layout') === 'center';
    const layoutDirection = getLayoutDirection();
    const typingActive = props.typing === true || props.names.length > 0;
    const typingText = typingActive
        ? (props.typingLabel ?? formatTypingText(props.names) ?? null)
        : null;
    const memberText =
        props.membersCount === null
            ? ''
            : `${props.membersCount} member${
                  props.membersCount === 1 ? '' : 's'
              }`;
    const countText =
        props.membersCount === null
            ? (props.fallbackText ?? '')
            : `${memberText}${props.suffix ?? ''}`;

    const [showTyping, setShowTyping] = useState(typingText !== null);
    const shownAtRef = useRef(Date.now());
    const lastTypingTextRef = useRef<string | null>(typingText);
    const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    if (typingText !== null) {
        lastTypingTextRef.current = typingText;
    }

    useEffect((): (() => void) => {
        if (typingText !== null) {
            if (hideTimerRef.current !== null) {
                clearTimeout(hideTimerRef.current);
                hideTimerRef.current = null;
            }
            if (!showTyping) {
                shownAtRef.current = Date.now();
                setShowTyping(true);
            }
        } else if (showTyping) {
            const remaining = Math.max(
                0,
                MIN_TYPING_VISIBLE_MS - (Date.now() - shownAtRef.current),
            );
            hideTimerRef.current = setTimeout((): void => {
                hideTimerRef.current = null;
                setShowTyping(false);
            }, remaining);
        }
        return (): void => {
            if (hideTimerRef.current !== null) {
                clearTimeout(hideTimerRef.current);
                hideTimerRef.current = null;
            }
        };
    }, [typingText, showTyping]);

    const visibleText =
        showTyping && lastTypingTextRef.current !== null
            ? lastTypingTextRef.current
            : countText;
    const visibleTyping = showTyping && lastTypingTextRef.current !== null;

    // Short fade between the member count and the typing line.
    const [displayed, setDisplayed] = useState({
        text: visibleText,
        typing: visibleTyping,
    });
    const fade = useRef(new Animated.Value(1)).current;

    useEffect((): (() => void) => {
        if (
            displayed.text === visibleText &&
            displayed.typing === visibleTyping
        ) {
            return (): void => undefined;
        }
        fade.stopAnimation();
        Animated.timing(fade, {
            toValue: 0,
            duration: FADE_MS,
            useNativeDriver: true,
        }).start(({ finished }) => {
            if (!finished) {
                return;
            }
            setDisplayed({ text: visibleText, typing: visibleTyping });
            Animated.timing(fade, {
                toValue: 1,
                duration: FADE_MS,
                useNativeDriver: true,
            }).start();
        });
        return (): void => {
            fade.stopAnimation();
        };
    }, [visibleText, visibleTyping, displayed, fade]);

    return (
        <View
            style={[
                styles.row,
                centered && styles.rowCenter,
                !centered && layoutDirection === 'rtl' && styles.rowRtl,
            ]}
            accessible={visibleText !== ''}
            accessibilityLabel={visibleText !== '' ? visibleText : undefined}
        >
            <Animated.Text
                style={[
                    styles.text,
                    {
                        writingDirection: layoutDirection,
                        textAlign: centered
                            ? 'center'
                            : layoutDirection === 'rtl'
                              ? 'right'
                              : 'left',
                    },
                    { opacity: fade },
                ]}
                numberOfLines={1}
                ellipsizeMode="tail"
                maxFontSizeMultiplier={MAX_FONT_SCALE}
            >
                {displayed.text}
            </Animated.Text>
            {displayed.typing && <TypingDots />}
        </View>
    );
}

const createStyles = (theme: AppTheme) =>
    StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'stretch',
        minWidth: 0,
        minHeight: 16,
        overflow: 'hidden',
    },
    rowRtl: { justifyContent: 'flex-end' },
    rowCenter: { justifyContent: 'center' },
    text: {
        flexShrink: 1,
        minWidth: 0,
        ...theme.type.caption,
        color: theme.colors.textSecondary,
        // Android adds font padding that differs between Persian and Latin
        // glyphs; the explicit line height above owns the row's height.
        includeFontPadding: false,
    },
    dotsRow: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        marginLeft: spacing.xxs / 2,
    },
    dot: {
        color: theme.colors.textSecondary,
        fontSize: 12,
        marginHorizontal: 0.5,
    },
    dots: {
        color: theme.colors.textSecondary,
        fontSize: 12,
        marginLeft: 2,
    },
});
