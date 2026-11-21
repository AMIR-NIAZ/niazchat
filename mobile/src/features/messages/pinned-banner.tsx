import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Pin } from 'lucide-react-native';
import {
    MAX_FONT_SCALE,
    palette,
    radii,
    spacing,
    typography,
} from '../../shared/theme';
import { SafeText } from '../../shared/components';
import { pinnedPreviewText } from './pinned-messages';
import type { ChatMessage } from './messages-model';

interface PinnedMessageBannerProps {
    /** Newest pin first (server order). Empty hides the banner. */
    pinned: ChatMessage[];
    /** Which pinned message is shown; tapping advances the caller's cursor. */
    index: number;
    onPress: (message: ChatMessage) => void;
    onClose: () => void;
}

/**
 * Compact pinned-message banner under the chat header. Shows one pinned
 * message at a time (newest first) with a `n/m` counter when several exist;
 * tapping jumps to the shown message, the small × dismisses the banner for
 * this screen only (the pin itself is untouched).
 */
export function PinnedMessageBanner({
    pinned,
    index,
    onPress,
    onClose,
}: PinnedMessageBannerProps): React.ReactElement | null {
    if (pinned.length === 0) {
        return null;
    }
    const safeIndex = ((index % pinned.length) + pinned.length) % pinned.length;
    const message = pinned[safeIndex] ?? pinned[0];
    if (message === undefined) {
        return null;
    }
    const sender = message.senderName.trim();
    const preview = pinnedPreviewText(message);
    const counter =
        pinned.length > 1 ? `${safeIndex + 1}/${pinned.length}` : null;

    return (
        <View style={styles.wrap}>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Pinned message: ${preview}`}
                accessibilityHint="Jump to the pinned message"
                onPress={(): void => onPress(message)}
                style={({ pressed }) => [
                    styles.card,
                    pressed && styles.pressed,
                ]}
            >
                <View style={styles.accent} />
                <Pin
                    size={15}
                    color={palette.primary[600]}
                    style={styles.icon}
                />
                <View style={styles.body}>
                    <View style={styles.titleRow}>
                        <SafeText
                            style={styles.title}
                            lines={1}
                            maxFontSizeMultiplier={MAX_FONT_SCALE}
                        >
                            Pinned Message
                        </SafeText>
                        {counter !== null && (
                            <SafeText
                                style={styles.counter}
                                lines={1}
                                maxFontSizeMultiplier={MAX_FONT_SCALE}
                            >
                                {counter}
                            </SafeText>
                        )}
                    </View>
                    <SafeText
                        style={styles.preview}
                        lines={1}
                        maxFontSizeMultiplier={MAX_FONT_SCALE}
                    >
                        {sender !== '' ? `${sender}: ${preview}` : preview}
                    </SafeText>
                </View>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Hide pinned banner"
                    hitSlop={8}
                    onPress={onClose}
                    style={({ pressed }) => [
                        styles.close,
                        pressed && styles.pressed,
                    ]}
                >
                    <Text style={styles.closeText}>×</Text>
                </Pressable>
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: {
        marginTop: spacing.xs,
    },
    card: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: spacing.xs,
        paddingHorizontal: spacing.sm,
        borderRadius: radii.md,
        backgroundColor: palette.glass.elevated,
        borderWidth: 1,
        borderColor: palette.border.accent,
        // Never a fixed height: the title + preview lines decide it. A fixed
        // 40 px (24 px content box) made the SafeText preview shrink to zero
        // height under flexShrink, so the pinned text disappeared.
        overflow: 'hidden',
        minHeight: 44,
    },
    pressed: {
        opacity: 0.75,
    },
    accent: {
        position: 'absolute',
        left: 0,
        top: 0,
        bottom: 0,
        width: 3,
        backgroundColor: palette.primary[300],
    },
    icon: {
        marginRight: spacing.xs,
        flexShrink: 0,
    },
    body: {
        flex: 1,
        minWidth: 0,
        justifyContent: 'center',
        gap: 1,
    },
    titleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xxs,
        minWidth: 0,
    },
    title: {
        ...typography.micro,
        flexShrink: 1,
        minWidth: 0,
        color: palette.primary[600],
    },
    counter: {
        ...typography.micro,
        flexShrink: 0,
        fontWeight: '500',
        color: palette.text.muted,
    },
    preview: {
        ...typography.caption,
        color: palette.text.primary,
    },
    close: {
        width: 26,
        height: 26,
        flexShrink: 0,
        alignItems: 'center',
        justifyContent: 'center',
        marginLeft: spacing.xxs,
    },
    closeText: {
        color: palette.text.muted,
        fontSize: 18,
        lineHeight: 20,
    },
});
