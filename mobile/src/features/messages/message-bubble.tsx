import { Pressable, StyleSheet, Text, View } from 'react-native';
import { palette, radii, spacing } from '../../shared/theme';
import { formatMessageTime } from './messages-model';
import type { ChatMessage } from './messages-model';
/**
 * A single message bubble. Mine → primary, right-aligned; others → white,
 * left-aligned with the sender name shown in group chats. Pending/failed
 * sends render with a status hint; failed sends tap-to-retry.
 */

interface MessageBubbleProps {
    message: ChatMessage;
    mine: boolean;
    isGroup: boolean;
    onLongPress?: ((message: ChatMessage) => void) | undefined;
    onRetryFailed?: ((message: ChatMessage) => void) | undefined;
}

export function MessageBubble(props: MessageBubbleProps): React.ReactElement {
    const { message, mine, isGroup, onLongPress, onRetryFailed } = props;
    const showSender = !mine && isGroup;
    const showFailedHint = message.status === 'failed';
    const isSending = message.status === 'pending';

    const body = (
        <View
            style={[
                styles.bubble,
                mine ? styles.mine : styles.theirs,
                showFailedHint && styles.failed,
            ]}
        >
            {showSender && (
                <Text style={styles.senderName}>{message.senderName}</Text>
            )}
            {message.content !== null && message.content !== '' && (
                <Text style={[styles.content, mine && styles.contentMine]}>
                    {message.content}
                </Text>
            )}
            {message.attachmentsCount > 0 && (
                <Text style={[styles.attachments, mine && styles.contentMine]}>
                    📎 {message.attachmentsCount} attachment
                    {message.attachmentsCount === 1 ? '' : 's'}
                </Text>
            )}
            <Text style={[styles.meta, mine && styles.metaMine]}>
                {formatMessageTime(message.createdAtIso)}
                {message.isEdited ? ' · edited' : ''}
                {isSending ? ' · sending…' : ''}
                {showFailedHint ? ' · not sent' : ''}
            </Text>
        </View>
    );

    if (showFailedHint && onRetryFailed !== undefined) {
        return (
            <View style={[styles.row, mine && styles.rowMine]}>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Retry sending message"
                    onPress={(): void => onRetryFailed(message)}
                >
                    {body}
                </Pressable>
            </View>
        );
    }

    return (
        <View style={[styles.row, mine && styles.rowMine]}>
            {onLongPress === undefined ? (
                body
            ) : (
                <Pressable
                    onLongPress={(): void => onLongPress(message)}
                    delayLongPress={400}
                >
                    {body}
                </Pressable>
            )}
        </View>
    );
}

/** Thin separator line rendered between two different calendar days. */
export function DateSeparator({
    label,
}: {
    label: string;
}): React.ReactElement {
    return (
        <View style={styles.separatorRow}>
            <View style={styles.separatorLine} />
            <Text style={styles.separatorLabel}>{label}</Text>
            <View style={styles.separatorLine} />
        </View>
    );
}

const styles = StyleSheet.create({
    row: {
        alignSelf: 'flex-start',
        maxWidth: '85%',
        marginVertical: spacing.xxs,
    },
    rowMine: { alignSelf: 'flex-end' },
    bubble: {
        borderRadius: radii.md,
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xs,
        backgroundColor: palette.neutral[0],
        borderColor: palette.neutral[100],
        borderWidth: 1,
    },
    mine: {
        backgroundColor: palette.primary[500],
        borderColor: palette.primary[600],
        borderBottomRightRadius: 4,
    },
    theirs: { borderBottomLeftRadius: 4 },
    failed: { opacity: 0.65 },
    senderName: {
        fontSize: 12,
        fontWeight: '600',
        color: palette.primary[700],
        marginBottom: 2,
    },
    content: { color: palette.neutral[900], fontSize: 15 },
    contentMine: { color: palette.neutral[0] },
    attachments: { color: palette.neutral[700], fontSize: 13, marginTop: 2 },
    meta: {
        color: palette.neutral[500],
        fontSize: 10,
        textAlign: 'right',
        marginTop: 2,
    },
    metaMine: { color: palette.primary[100] },
    separatorRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        marginVertical: spacing.sm,
    },
    separatorLine: {
        flex: 1,
        height: 1,
        backgroundColor: palette.neutral[100],
    },
    separatorLabel: { color: palette.neutral[500], fontSize: 12 },
});
