import { Pressable, StyleSheet, Text, View } from 'react-native';
import { UserAvatar } from '../../shared/components';
import { palette, radii, spacing } from '../../shared/theme';
import { formatMessageTime, isOwnMessage } from './messages-model';
import type { ChatMessage, ReplyPreview } from './messages-model';
/**
 * A single message bubble. Mine → primary, right-aligned; others → white,
 * left-aligned with the sender name shown in group chats. Pending/failed
 * sends render with a status hint; failed sends tap-to-retry. Replies render a
 * compact quoted block at the top that jumps to the original when tapped.
 */

interface MessageBubbleProps {
    message: ChatMessage;
    mine: boolean;
    isGroup: boolean;
    currentUserId: number | null;
    onLongPress?: ((message: ChatMessage) => void) | undefined;
    onRetryFailed?: ((message: ChatMessage) => void) | undefined;
    onReplyPress?: ((replyId: number) => void) | undefined;
    highlighted?: boolean;
    /** Highest seen id among the other members (drives my tick state). */
    othersLastSeenId?: number | null;
    /** Sender name only on the FIRST message of a run (group chats). */
    showSenderName?: boolean;
    /** Sender avatar only on the LAST message of a run (group chats). */
    showAvatar?: boolean;
    /**
     * Opens the sender's user-info screen. Only wired for OTHER users' group
     * messages; the bubble body itself never navigates.
     */
    onOpenProfile?: ((message: ChatMessage) => void) | undefined;
}

/** Bubble avatar edge length (the spacer keeps the other rows aligned). */
const AVATAR_SIZE = 45;

function quoteSnippet(reply: ReplyPreview): string {
    if (reply.isDeleted) {
        return 'Message deleted';
    }
    if (reply.content !== null && reply.content.trim() !== '') {
        return reply.content;
    }
    if (reply.attachmentsCount > 0) {
        return `📎 ${reply.attachmentsCount} attachment${
            reply.attachmentsCount === 1 ? '' : 's'
        }`;
    }
    return '';
}

export function MessageBubble(props: MessageBubbleProps): React.ReactElement {
    const {
        message,
        mine,
        isGroup,
        currentUserId,
        onLongPress,
        onRetryFailed,
        onReplyPress,
        highlighted = false,
        othersLastSeenId = null,
        showSenderName = true,
        showAvatar = false,
        onOpenProfile,
    } = props;
    const showSender = !mine && isGroup && showSenderName;
    const showFailedHint = message.status === 'failed';
    const isSending = message.status === 'pending';
    const seenByOthers =
        mine &&
        message.status === 'sent' &&
        message.id !== null &&
        othersLastSeenId !== null &&
        message.id <= othersLastSeenId;

    const reply = message.replyTo;
    const replyId = reply?.id ?? message.replyToId;
    const hasReply = reply !== null || replyId !== null;
    const replyDeleted = reply === null || reply.isDeleted;
    const replyName =
        reply === null
            ? ''
            : isOwnMessage(currentUserId, reply.senderId)
              ? 'You'
              : reply.senderName !== ''
                ? reply.senderName
                : 'Unknown';
    const canJump =
        replyId !== null && !replyDeleted && onReplyPress !== undefined;

    const body = (
        <View
            style={[
                styles.bubble,
                mine ? styles.mine : styles.theirs,
                showFailedHint && styles.failed,
                highlighted && styles.highlighted,
            ]}
        >
            {hasReply && (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Jump to replied message"
                    disabled={!canJump}
                    onPress={
                        canJump &&
                        replyId !== null &&
                        onReplyPress !== undefined
                            ? (): void => onReplyPress(replyId)
                            : undefined
                    }
                    style={[
                        styles.quote,
                        mine ? styles.quoteMine : styles.quoteTheirs,
                    ]}
                >
                    <View
                        style={[
                            styles.quoteBar,
                            mine ? styles.quoteBarMine : styles.quoteBarTheirs,
                        ]}
                    />
                    <View style={styles.quoteBody}>
                        {!replyDeleted && (
                            <Text
                                style={[
                                    styles.quoteName,
                                    mine && styles.quoteNameMine,
                                ]}
                                numberOfLines={1}
                            >
                                {replyName}
                            </Text>
                        )}
                        <Text
                            style={[
                                styles.quoteText,
                                mine && styles.quoteTextMine,
                                replyDeleted && styles.quoteDeleted,
                            ]}
                            numberOfLines={2}
                        >
                            {replyDeleted
                                ? 'Message deleted'
                                : reply !== null
                                  ? quoteSnippet(reply)
                                  : ''}
                        </Text>
                    </View>
                </Pressable>
            )}
            {showSender &&
                (onOpenProfile === undefined ? (
                    <Text style={styles.senderName}>{message.senderName}</Text>
                ) : (
                    // Separate tappable target from the bubble: long-press,
                    // retry, selection and swipe-to-reply stay untouched.
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Open profile of ${message.senderName}`}
                        hitSlop={{ top: 15, bottom: 15, left: 8, right: 8 }}
                        onPress={(): void => onOpenProfile(message)}
                        style={({ pressed }) => pressed && styles.pressed}
                    >
                        <Text style={styles.senderName}>
                            {message.senderName}
                        </Text>
                    </Pressable>
                ))}
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
                {mine && !showFailedHint && (
                    <Text
                        accessibilityLabel={
                            seenByOthers
                                ? 'Seen'
                                : isSending
                                  ? 'Sending'
                                  : 'Sent'
                        }
                        style={[styles.ticks, seenByOthers && styles.ticksSeen]}
                    >
                        {isSending ? ' 🕓' : seenByOthers ? ' ✓✓' : ' ✓'}
                    </Text>
                )}
            </Text>
        </View>
    );

    const bubbleBody =
        showFailedHint && onRetryFailed !== undefined ? (
            <Pressable
                accessibilityRole="button"
                accessibilityLabel="Retry sending message"
                onPress={(): void => onRetryFailed(message)}
            >
                {body}
            </Pressable>
        ) : onLongPress === undefined ? (
            body
        ) : (
            <Pressable
                onLongPress={(): void => onLongPress(message)}
                delayLongPress={400}
            >
                {body}
            </Pressable>
        );

    // Private chats and my own messages keep the original full-width layout.
    if (!isGroup || mine) {
        return (
            <View style={[styles.row, mine && styles.rowMine]}>
                {bubbleBody}
            </View>
        );
    }

    return (
        <View style={[styles.row, styles.groupRow]}>
            {/* Always reserved, so a run keeps one bubble edge; only the last
                message of the run paints the avatar (bottom aligned). */}
            <View style={styles.avatarSlot}>
                {showAvatar &&
                    (onOpenProfile === undefined ? (
                        <UserAvatar
                            userId={message.senderId}
                            name={message.senderName}
                            uri={message.senderAvatarPath}
                            size={AVATAR_SIZE}
                        />
                    ) : (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Open profile of ${message.senderName}`}
                            // 32 px circle + 6 px on each side = 44 px target.
                            hitSlop={6}
                            onPress={(): void => onOpenProfile(message)}
                            style={({ pressed }) => pressed && styles.pressed}
                        >
                            <UserAvatar
                                userId={message.senderId}
                                name={message.senderName}
                                uri={message.senderAvatarPath}
                                size={AVATAR_SIZE}
                            />
                        </Pressable>
                    ))}
            </View>
            <View style={styles.bubbleSlot}>{bubbleBody}</View>
        </View>
    );
}

/** Divider shown where the user's unread messages start (when the chat opens). */
export function UnreadDivider(): React.ReactElement {
    return (
        <View style={styles.unreadRow}>
            <View style={styles.unreadLine} />
            <Text style={styles.unreadLabel}>New messages</Text>
            <View style={styles.unreadLine} />
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
    groupRow: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: spacing.xs,
    },
    avatarSlot: { width: AVATAR_SIZE },
    bubbleSlot: { flexShrink: 1 },
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
    pressed: { opacity: 0.6 },
    highlighted: {
        borderColor: palette.semantic.warning,
        borderWidth: 2,
    },
    senderName: {
        fontSize: 12,
        fontWeight: '600',
        color: palette.primary[700],
        marginBottom: 2,
    },
    // quoted reply block
    quote: {
        flexDirection: 'row',
        borderRadius: radii.sm,
        overflow: 'hidden',
        marginBottom: spacing.xxs,
        maxWidth: '100%',
    },
    quoteTheirs: { backgroundColor: palette.neutral[50] },
    quoteMine: { backgroundColor: 'rgba(255,255,255,0.16)' },
    quoteBar: { width: 3 },
    quoteBarTheirs: { backgroundColor: palette.primary[500] },
    quoteBarMine: { backgroundColor: palette.primary[100] },
    quoteBody: {
        flexShrink: 1,
        paddingHorizontal: spacing.xs,
        paddingVertical: spacing.xxs,
    },
    quoteName: {
        color: palette.primary[700],
        fontSize: 11,
        fontWeight: '700',
    },
    quoteNameMine: { color: palette.primary[100] },
    quoteText: { color: palette.neutral[700], fontSize: 12 },
    quoteTextMine: { color: palette.primary[100] },
    quoteDeleted: { fontStyle: 'italic' },
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
    ticks: { fontSize: 10 },
    ticksSeen: { color: palette.neutral[0], fontWeight: '700' },
    unreadRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        marginVertical: spacing.sm,
    },
    unreadLine: { flex: 1, height: 1, backgroundColor: palette.primary[100] },
    unreadLabel: {
        color: palette.primary[600],
        fontSize: 12,
        fontWeight: '600',
    },
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
