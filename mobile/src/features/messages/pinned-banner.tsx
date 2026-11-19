import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Pin } from 'lucide-react-native';
import { palette, radii, spacing } from '../../shared/theme';
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
                        <Text style={styles.title}>Pinned Message</Text>
                        {counter !== null && (
                            <Text style={styles.counter}>{counter}</Text>
                        )}
                    </View>
                    <Text style={styles.preview} numberOfLines={1}>
                        {sender !== '' ? `${sender}: ${preview}` : preview}
                    </Text>
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
        overflow: 'hidden',
        height: 40,
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
    },
    body: {
        flex: 1,
        minWidth: 0,
    },
    titleRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    title: {
        color: palette.primary[600],
        fontSize: 11,
        fontWeight: '700',
    },
    counter: {
        color: palette.text.muted,
        fontSize: 10,
        marginLeft: spacing.xxs,
    },
    preview: {
        color: palette.text.primary,
        fontSize: 12,
        marginTop: 1,
    },
    close: {
        width: 26,
        height: 26,
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
