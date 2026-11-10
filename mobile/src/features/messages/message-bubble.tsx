import { Pressable, StyleSheet, Text, View } from 'react-native';
import { UserAvatar } from '../../shared/components';
import { palette, radii, spacing } from '../../shared/theme';
import { LONG_PRESS_DELAY_MS } from '../../shared/long-press';
import { formatMessageTime, isOwnMessage } from './messages-model';
import type { ChatMessage, ReplyPreview } from './messages-model';
import { attachmentPreviewLabel } from '../attachments/attachment-labels';
import { AttachmentGrid } from '../attachments/attachment-grid';
import { AttachmentFileRow } from '../attachments/attachment-file-row';
import { VoiceBubble } from '../voice/voice-bubble';
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
    /** Opens the full-screen viewer at an image/video of this message. */
    onOpenMedia?:
        | ((message: ChatMessage, mediaIndex: number) => void)
        | undefined;
    /** Aborts the uploads of an optimistic bubble and removes it. */
    onCancelPending?: ((message: ChatMessage) => void) | undefined;
    /** Re-uploads only failed files / resends after a socket failure. */
    onRetryPending?: ((message: ChatMessage) => void) | undefined;
    /** Removes a failed bubble (uploaded files become server orphans). */
    onRemovePending?: ((message: ChatMessage) => void) | undefined;
    /** Selection mode: tapping the bubble toggles it, actions are disabled. */
    selectionMode?: boolean;
    selected?: boolean;
    onToggleSelect?: ((message: ChatMessage) => void) | undefined;
    onForwardedProfilePress?:
        | ((userId: number, name: string) => void)
        | undefined;
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
    return attachmentPreviewLabel(
        reply.attachmentsCount,
        reply.attachmentKind,
        null,
        reply.attachmentDuration,
    );
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
        onOpenMedia,
        onCancelPending,
        onRetryPending,
        onRemovePending,
        selectionMode = false,
        selected = false,
        onToggleSelect,
        onForwardedProfilePress,
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
    // Images and videos share one grid/viewer; only generic files get rows.
    const mediaAttachments = message.attachments.filter(
        (attachment) =>
            attachment.kind === 'image' || attachment.kind === 'video',
    );
    const fileAttachments = message.attachments.filter(
        (attachment) => attachment.kind === 'file',
    );
    const voiceAttachments = message.attachments.filter(
        (attachment) => attachment.kind === 'voice',
    );
    const uploadingAttachments = message.attachments.some(
        (attachment) => attachment.status === 'uploading',
    );
    const failedAttachmentReason =
        message.attachments.find((attachment) => attachment.status === 'failed')
            ?.error ?? null;
    const failed =
        message.status === 'failed' ||
        message.attachments.some(
            (attachment) => attachment.status === 'failed',
        );
    const showPendingActions =
        message.status !== 'sent' &&
        message.attachments.length > 0 &&
        (uploadingAttachments || failed);

    const forwarded = message.forwardedFrom;
    const body = (
        <View
            style={[
                styles.bubble,
                mine ? styles.mine : styles.theirs,
                showFailedHint && styles.failed,
                highlighted && styles.highlighted,
                selected && styles.selectedBubble,
            ]}
        >
            {forwarded !== null && (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Forwarded from ${forwarded.name || 'unknown'}`}
                    disabled={selectionMode}
                    onLongPress={
                        onLongPress === undefined
                            ? undefined
                            : (): void => onLongPress(message)
                    }
                    delayLongPress={LONG_PRESS_DELAY_MS}
                    onPress={
                        forwarded.userId !== null &&
                        onForwardedProfilePress !== undefined
                            ? (): void =>
                                  onForwardedProfilePress(
                                      forwarded.userId as number,
                                      forwarded.name,
                                  )
                            : undefined
                    }
                    style={styles.forwardHeader}
                >
                    <Text
                        style={[
                            styles.forwardText,
                            mine && styles.forwardTextMine,
                        ]}
                        numberOfLines={1}
                    >
                        ↗ Forwarded from {forwarded.name || 'unknown'}
                    </Text>
                </Pressable>
            )}
            {hasReply && (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Jump to replied message"
                    disabled={selectionMode}
                    onLongPress={
                        onLongPress === undefined
                            ? undefined
                            : (): void => onLongPress(message)
                    }
                    delayLongPress={LONG_PRESS_DELAY_MS}
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
                        onLongPress={
                            onLongPress === undefined
                                ? undefined
                                : (): void => onLongPress(message)
                        }
                        delayLongPress={LONG_PRESS_DELAY_MS}
                        style={({ pressed }) => pressed && styles.pressed}
                    >
                        <Text style={styles.senderName}>
                            {message.senderName}
                        </Text>
                    </Pressable>
                ))}
            {message.attachments.length > 0 && (
                <View style={styles.attachmentsWrap}>
                    {voiceAttachments.map((attachment) => (
                        <VoiceBubble
                            key={attachment.key}
                            attachment={attachment}
                            mine={mine}
                            onLongPress={
                                onLongPress === undefined
                                    ? undefined
                                    : (): void => onLongPress(message)
                            }
                        />
                    ))}
                    {mediaAttachments.length > 0 && (
                        <AttachmentGrid
                            attachments={mediaAttachments}
                            onOpenMedia={(mediaIndex): void =>
                                onOpenMedia?.(message, mediaIndex)
                            }
                            onLongPress={
                                onLongPress === undefined
                                    ? undefined
                                    : (): void => onLongPress(message)
                            }
                        />
                    )}
                    {fileAttachments.length > 0 && (
                        <View
                            style={[
                                styles.filesBlock,
                                mine
                                    ? styles.filesBlockMine
                                    : styles.filesBlockTheirs,
                            ]}
                        >
                            {fileAttachments.map((attachment, index) => (
                                <View key={attachment.key}>
                                    {index > 0 && (
                                        <View
                                            style={[
                                                styles.fileDivider,
                                                mine && styles.fileDividerMine,
                                            ]}
                                        />
                                    )}
                                    <AttachmentFileRow
                                        attachment={attachment}
                                        mine={mine}
                                        onLongPress={
                                            onLongPress === undefined
                                                ? undefined
                                                : (): void =>
                                                      onLongPress(message)
                                        }
                                    />
                                </View>
                            ))}
                        </View>
                    )}
                </View>
            )}
            {failedAttachmentReason !== null && (
                <Text
                    style={[styles.uploadError, mine && styles.uploadErrorMine]}
                >
                    {failedAttachmentReason}
                </Text>
            )}
            {message.content !== null && message.content !== '' && (
                <Text
                    style={[
                        styles.content,
                        mine && styles.contentMine,
                        message.attachments.length > 0 && styles.caption,
                    ]}
                >
                    {message.content}
                </Text>
            )}
            {showPendingActions && (
                <View style={styles.pendingActions}>
                    {failed &&
                        !uploadingAttachments &&
                        onRetryPending !== undefined && (
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="Retry sending attachments"
                                onPress={(): void => onRetryPending(message)}
                                style={styles.pendingButton}
                            >
                                <Text
                                    style={[
                                        styles.pendingButtonText,
                                        mine && styles.pendingButtonTextMine,
                                    ]}
                                >
                                    Retry
                                </Text>
                            </Pressable>
                        )}
                    {failed &&
                        !uploadingAttachments &&
                        onRemovePending !== undefined && (
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="Remove failed message"
                                onPress={(): void => onRemovePending(message)}
                                style={styles.pendingButton}
                            >
                                <Text
                                    style={[
                                        styles.pendingButtonText,
                                        mine && styles.pendingButtonTextMine,
                                    ]}
                                >
                                    Remove
                                </Text>
                            </Pressable>
                        )}
                    {uploadingAttachments && onCancelPending !== undefined && (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Cancel uploading message"
                            onPress={(): void => onCancelPending(message)}
                            style={styles.pendingButton}
                        >
                            <Text
                                style={[
                                    styles.pendingButtonText,
                                    mine && styles.pendingButtonTextMine,
                                ]}
                            >
                                Cancel
                            </Text>
                        </Pressable>
                    )}
                </View>
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

    const bubbleBody = selectionMode ? (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={
                selected ? 'Deselect message' : 'Select message'
            }
            accessibilityState={{ selected }}
            onPress={
                onToggleSelect === undefined
                    ? undefined
                    : (): void => onToggleSelect(message)
            }
        >
            {body}
        </Pressable>
    ) : showFailedHint &&
      message.attachments.length === 0 &&
      onRetryFailed !== undefined ? (
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

    const withSelection = selectionMode ? (
        <View style={[styles.selectionRow, mine && styles.selectionRowMine]}>
            <View
                style={[styles.selectionCheck, selected && styles.selectionOn]}
            >
                <Text style={styles.selectionMark}>{selected ? '✓' : ''}</Text>
            </View>
            <View style={styles.selectionBody}>{bubbleBody}</View>
        </View>
    ) : (
        bubbleBody
    );

    // Private chats and my own messages keep the original full-width layout.
    if (!isGroup || mine) {
        return (
            <View style={[styles.row, mine && styles.rowMine]}>
                {withSelection}
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
            <View style={styles.bubbleSlot}>{withSelection}</View>
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
    selectedBubble: {
        borderColor: palette.primary[600],
        borderWidth: 2,
    },
    forwardHeader: { marginBottom: 3 },
    forwardText: {
        color: palette.primary[700],
        fontSize: 11,
        fontWeight: '700',
    },
    forwardTextMine: { color: palette.primary[100] },
    selectionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
    },
    selectionRowMine: { alignSelf: 'flex-end' },
    selectionBody: { flexShrink: 1, maxWidth: '100%' },
    selectionCheck: {
        width: 24,
        height: 24,
        borderRadius: 12,
        borderWidth: 1.5,
        borderColor: palette.neutral[300],
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: palette.neutral[0],
    },
    selectionOn: {
        backgroundColor: palette.primary[500],
        borderColor: palette.primary[500],
    },
    selectionMark: {
        color: palette.neutral[0],
        fontSize: 13,
        fontWeight: '700',
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
    caption: { marginTop: spacing.xxs },
    uploadError: {
        color: palette.semantic.danger,
        fontSize: 11,
        marginTop: 2,
    },
    uploadErrorMine: { color: palette.primary[100] },
    attachmentsWrap: { maxWidth: 260, width: '100%' },
    filesBlock: {
        borderRadius: radii.sm,
        overflow: 'hidden',
        marginTop: spacing.xxs,
    },
    filesBlockMine: { backgroundColor: 'rgba(255,255,255,0.16)' },
    filesBlockTheirs: { backgroundColor: palette.neutral[50] },
    fileDivider: {
        height: StyleSheet.hairlineWidth,
        backgroundColor: palette.neutral[100],
        marginHorizontal: spacing.xs,
    },
    fileDividerMine: { backgroundColor: 'rgba(255,255,255,0.28)' },
    pendingActions: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        gap: spacing.xs,
        marginTop: spacing.xxs,
    },
    pendingButton: {
        paddingHorizontal: spacing.xs,
        paddingVertical: 2,
        borderRadius: radii.sm,
        backgroundColor: 'rgba(28, 32, 36, 0.12)',
    },
    pendingButtonText: {
        color: palette.neutral[700],
        fontSize: 11,
        fontWeight: '700',
    },
    pendingButtonTextMine: { color: palette.neutral[0] },
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
