import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentRef } from 'react';
import {
    AccessibilityInfo,
    Animated,
    Pressable,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { Image } from 'expo-image';
import { UserAvatar } from '../../shared/components';
import { palette, radii, spacing } from '../../shared/theme';
import { LONG_PRESS_DELAY_MS } from '../../shared/long-press';
import { measureInWindow } from '../../shared/context-popup';
import type { PopupRect } from '../../shared/context-popup';
import { formatMessageTime, isOwnMessage } from './messages-model';
import type {
    AttachmentView,
    ChatMessage,
    ReplyPreview,
} from './messages-model';
import {
    attachmentPreviewLabel,
    formatFileSize,
} from '../attachments/attachment-labels';
import { attachmentPreviewUrl } from '../attachments/attachment-url';
import { fileTypeLabel } from '../attachments/file-name';
import { formatDuration } from '../attachments/duration';
import { AttachmentGrid } from '../attachments/attachment-grid';
import { AttachmentFileRow } from '../attachments/attachment-file-row';
import { VoiceBubble } from '../voice/voice-bubble';
import { splitLinkifiedText } from '../groups/invite-links-model';
import { childPressBlocksMenu, resolveBubblePress } from './bubble-press';
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
    /** Opens the floating menu around this bubble (tap or long press). */
    onOpenMenu?:
        | ((message: ChatMessage, anchor: PopupRect) => void)
        | undefined;
    /** Screen-reader actions, so the gestures are never required. */
    accessibilityActions?: { name: string; label: string }[] | undefined;
    onAccessibilityAction?: ((actionName: string) => void) | undefined;
    /** Static copy for the popup preview: no handlers, no players, no animations. */
    isStatic?: boolean | undefined;
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
    /** Opens a tappable link inside the message body (invite links, URLs). */
    onOpenLink?: ((url: string) => void) | undefined;
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
    /** Toggle the caller's reaction with a chip/quick-bar emoji. */
    onToggleReaction?:
        | ((message: ChatMessage, emoji: string) => void)
        | undefined;
    /** Long-press on the reaction row: open the grouped reactor sheet. */
    onOpenReactions?: ((message: ChatMessage) => void) | undefined;
}

/** Bubble avatar edge length (the spacer keeps the other rows aligned). */
const AVATAR_SIZE = 45;

/** Tap and hold both open the same floating menu. */
const BUBBLE_LONG_PRESS_MS = 350;
/** Height cap for the static media tile in the lifted preview. */
const STATIC_MEDIA_HEIGHT = 180;

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
        onOpenMenu,
        accessibilityActions,
        onAccessibilityAction,
        isStatic = false,
        onRetryFailed,
        onReplyPress,
        highlighted = false,
        othersLastSeenId = null,
        showSenderName = true,
        showAvatar = false,
        onOpenProfile,
        onOpenLink,
        onOpenMedia,
        onCancelPending,
        onRetryPending,
        onRemovePending,
        selectionMode = false,
        selected = false,
        onToggleSelect,
        onForwardedProfilePress,
        onToggleReaction,
        onOpenReactions,
    } = props;
    // Anchor of the lifted preview: measured in window coordinates at press
    // time so the popup lands on the bubble with the keyboard open too.
    const bubbleRef = useRef<ComponentRef<typeof View>>(null);
    // A child control that saw this touch start keeps its own behaviour; the
    // bubble menu is suppressed for the remainder of that gesture.
    const childPressAtRef = useRef(0);
    const markChildPress = useCallback((): void => {
        childPressAtRef.current = Date.now();
    }, []);

    const showMenu =
        !selectionMode && message.status === 'sent' && message.id !== null;

    const openMenu = useCallback((): void => {
        if (onOpenMenu === undefined) {
            return;
        }
        void measureInWindow(bubbleRef).then((anchor): void => {
            if (anchor === null) {
                return;
            }
            onOpenMenu(message, anchor);
        });
    }, [message, onOpenMenu]);

    const handlePress = (): void => {
        const outcome = resolveBubblePress({
            selectionMode,
            status: message.status,
            hasAttachments: message.attachments.length > 0,
            hasConfirmedId: message.id !== null,
            childHandled: childPressBlocksMenu(
                childPressAtRef.current,
                Date.now(),
            ),
        });
        if (outcome === 'select') {
            onToggleSelect?.(message);
            return;
        }
        if (outcome === 'retry') {
            onRetryFailed?.(message);
            return;
        }
        if (outcome === 'menu') {
            openMenu();
        }
    };

    const childLongPress =
        !isStatic && showMenu && onOpenMenu !== undefined
            ? openMenu
            : undefined;

    const showSender = !mine && isGroup && showSenderName;
    const showFailedHint = message.status === 'failed';
    const isSending = message.status === 'pending';
    const seenByOthers =
        mine &&
        message.status === 'sent' &&
        message.id !== null &&
        othersLastSeenId !== null &&
        message.id <= othersLastSeenId;

    // Split once per content change; plain text is the single-segment case.
    const contentSegments = useMemo(
        () =>
            message.content === null ? [] : splitLinkifiedText(message.content),
        [message.content],
    );
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
            ref={bubbleRef}
            collapsable={false}
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
                    onPressIn={markChildPress}
                    onLongPress={childLongPress}
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
                    onPressIn={markChildPress}
                    onLongPress={childLongPress}
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
                        onPressIn={markChildPress}
                        onLongPress={childLongPress}
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
                    {voiceAttachments.map((attachment) =>
                        isStatic ? (
                            <StaticVoiceRow
                                key={attachment.key}
                                attachment={attachment}
                                mine={mine}
                            />
                        ) : (
                            <VoiceBubble
                                key={attachment.key}
                                attachment={attachment}
                                mine={mine}
                                onLongPress={childLongPress}
                            />
                        ),
                    )}
                    {mediaAttachments.length > 0 &&
                        (isStatic ? (
                            <StaticMediaGrid attachments={mediaAttachments} />
                        ) : (
                            <AttachmentGrid
                                attachments={mediaAttachments}
                                onOpenMedia={(mediaIndex): void =>
                                    onOpenMedia?.(message, mediaIndex)
                                }
                                onLongPress={childLongPress}
                            />
                        ))}
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
                                    {isStatic ? (
                                        <StaticFileRow
                                            attachment={attachment}
                                            mine={mine}
                                        />
                                    ) : (
                                        <AttachmentFileRow
                                            attachment={attachment}
                                            mine={mine}
                                            onLongPress={childLongPress}
                                        />
                                    )}
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
                    {contentSegments.map((segment, index) =>
                        segment.type === 'text' ? (
                            <Text key={index}>{segment.text}</Text>
                        ) : (
                            <Text
                                key={index}
                                accessibilityRole="link"
                                accessibilityLabel={segment.url}
                                style={[styles.link, mine && styles.linkMine]}
                                onPress={
                                    onOpenLink === undefined
                                        ? undefined
                                        : (): void => {
                                              markChildPress();
                                              onOpenLink(segment.url);
                                          }
                                }
                            >
                                {segment.text}
                            </Text>
                        ),
                    )}
                </Text>
            )}
            {message.reactions.length > 0 && (
                <ReactionChips
                    message={message}
                    mine={mine}
                    isStatic={isStatic}
                    onToggle={onToggleReaction}
                    onOpen={onOpenReactions}
                />
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

    if (isStatic) {
        // Lifted preview: same markup, zero interactivity or side effects.
        return <View pointerEvents="none">{body}</View>;
    }

    const bubbleBody = (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={
                selectionMode
                    ? selected
                        ? 'Deselect message'
                        : 'Select message'
                    : 'Message actions'
            }
            accessibilityHint={
                selectionMode
                    ? undefined
                    : 'Tap or long press for message actions'
            }
            accessibilityState={selectionMode ? { selected } : undefined}
            accessibilityActions={accessibilityActions}
            onAccessibilityAction={
                onAccessibilityAction === undefined
                    ? undefined
                    : (event): void =>
                          onAccessibilityAction(event.nativeEvent.actionName)
            }
            onPress={handlePress}
            onLongPress={showMenu ? openMenu : undefined}
            delayLongPress={BUBBLE_LONG_PRESS_MS}
            style={({ pressed }) =>
                pressed && !selectionMode ? styles.pressed : undefined
            }
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

interface ReactionChipsProps {
    message: ChatMessage;
    mine: boolean;
    /** Lifted preview: no press handlers and no entrance animation. */
    isStatic?: boolean | undefined;
    onToggle?: ((message: ChatMessage, emoji: string) => void) | undefined;
    onOpen?: ((message: ChatMessage) => void) | undefined;
}

/**
 * Wrapped emoji + count chips inside the bubble, above the meta line. Tapping
 * toggles the caller's reaction; long-pressing any chip opens the reactor list.
 * The whole row scales in once when a new chip appears (native driver).
 */
function ReactionChips(props: ReactionChipsProps): React.ReactElement {
    const { message, mine, isStatic = false, onToggle, onOpen } = props;
    const scale = useRef(new Animated.Value(1)).current;
    const [reduceMotion, setReduceMotion] = useState(false);

    useEffect((): (() => void) => {
        let active = true;
        void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
            if (active) setReduceMotion(enabled);
        });
        const subscription = AccessibilityInfo.addEventListener(
            'reduceMotionChanged',
            setReduceMotion,
        );
        return (): void => {
            active = false;
            subscription.remove();
        };
    }, []);

    useEffect((): void => {
        if (isStatic || reduceMotion) {
            scale.setValue(1);
            return;
        }
        scale.setValue(0.88);
        Animated.spring(scale, {
            toValue: 1,
            damping: 16,
            mass: 0.5,
            stiffness: 220,
            useNativeDriver: true,
        }).start();
    }, [message.reactions.length, reduceMotion, isStatic, scale]);

    return (
        <Animated.View
            style={[styles.reactionRow, { transform: [{ scale }] }]}
            accessibilityLabel="Reactions list"
        >
            {message.reactions.map((reaction) => {
                const selected =
                    message.myReaction !== null &&
                    message.myReaction.replace(/\uFE0F/g, '') ===
                        reaction.emoji.replace(/\uFE0F/g, '');
                return (
                    <Pressable
                        key={reaction.emoji}
                        accessibilityRole="button"
                        accessibilityLabel={`${reaction.emoji}, ${reaction.count} reactions${selected ? ', you reacted' : ''}`}
                        accessibilityState={{ selected }}
                        onPress={
                            onToggle === undefined
                                ? undefined
                                : (): void => onToggle(message, reaction.emoji)
                        }
                        onLongPress={
                            onOpen === undefined
                                ? undefined
                                : (): void => onOpen(message)
                        }
                        delayLongPress={400}
                        style={({ pressed }) => [
                            styles.reactionChip,
                            mine
                                ? selected
                                    ? styles.reactionMineSelected
                                    : styles.reactionMine
                                : selected
                                  ? styles.reactionTheirsSelected
                                  : styles.reactionTheirs,
                            pressed && styles.pressed,
                        ]}
                    >
                        <Text
                            style={[
                                styles.reactionText,
                                mine
                                    ? selected
                                        ? styles.reactionTextMineSelected
                                        : styles.reactionTextMine
                                    : selected
                                      ? styles.reactionTextTheirsSelected
                                      : styles.reactionTextTheirs,
                            ]}
                        >
                            {reaction.emoji}
                            {` ${reaction.count}`}
                        </Text>
                    </Pressable>
                );
            })}
        </Animated.View>
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

/**
 * Static voice row for the lifted preview: identical waveform/time layout with
 * no player mounted (no cache read, no audio, no playback subscription).
 */
function StaticVoiceRow({
    attachment,
    mine,
}: {
    attachment: AttachmentView;
    mine: boolean;
}): React.ReactElement {
    const waveform = attachment.waveform ?? attachment.localWaveform ?? null;
    const bars =
        Array.isArray(waveform) && waveform.length === 64 ? waveform : null;
    const duration = attachment.duration ?? attachment.localDuration ?? 0;
    return (
        <View style={staticStyles.voiceRow}>
            <View
                style={[
                    staticStyles.voiceButton,
                    mine
                        ? staticStyles.voiceButtonMine
                        : staticStyles.voiceButtonTheirs,
                ]}
            >
                <Text
                    style={[
                        staticStyles.voiceGlyph,
                        mine && staticStyles.onAccentText,
                    ]}
                >
                    ▶
                </Text>
            </View>
            <View style={staticStyles.waveform}>
                {Array.from({ length: 64 }, (_, index) => (
                    <View
                        key={index}
                        style={[
                            staticStyles.bar,
                            {
                                height:
                                    bars === null
                                        ? 5
                                        : 4 + (bars[index] ?? 0) * 0.22,
                                backgroundColor: mine
                                    ? 'rgba(255,255,255,0.45)'
                                    : palette.neutral[300],
                            },
                        ]}
                    />
                ))}
            </View>
            <Text
                style={[staticStyles.speed, mine && staticStyles.onAccentText]}
            >
                1x
            </Text>
            <Text
                style={[staticStyles.time, mine && staticStyles.onAccentText]}
            >
                {formatDuration(duration)}
            </Text>
        </View>
    );
}

/** Media tiles for the lifted preview: cached thumbnails only, no handlers. */
function StaticMediaGrid({
    attachments,
}: {
    attachments: readonly AttachmentView[];
}): React.ReactElement {
    const visible = attachments.slice(0, 4);
    const extra = attachments.length - visible.length;
    return (
        <View style={staticStyles.grid}>
            {visible.map((attachment, index) => {
                const single = visible.length === 1;
                const width = single ? 240 : 116;
                const height = single ? STATIC_MEDIA_HEIGHT : 116;
                const poster =
                    attachment.id !== null &&
                    (attachment.kind !== 'video' ||
                        attachment.hasPoster === true)
                        ? attachmentPreviewUrl(attachment.id, 640)
                        : attachment.kind === 'image'
                          ? (attachment.localUri ?? null)
                          : null;
                return (
                    <View
                        key={attachment.key}
                        style={[staticStyles.tile, { width, height }]}
                    >
                        {poster !== null && (
                            <Image
                                source={{ uri: poster }}
                                cachePolicy="disk"
                                contentFit="cover"
                                style={staticStyles.image}
                            />
                        )}
                        {attachment.kind === 'video' && (
                            <View style={staticStyles.playBadge}>
                                <Text style={staticStyles.playIcon}>▶</Text>
                            </View>
                        )}
                        {extra > 0 && index === visible.length - 1 && (
                            <View style={staticStyles.countOverlay}>
                                <Text style={staticStyles.countText}>
                                    {`+${extra}`}
                                </Text>
                            </View>
                        )}
                    </View>
                );
            })}
        </View>
    );
}

/** Document row for the lifted preview: no cache lookup, no download. */
function StaticFileRow({
    attachment,
    mine,
}: {
    attachment: AttachmentView;
    mine: boolean;
}): React.ReactElement {
    return (
        <View style={staticStyles.fileRow}>
            <Text
                style={[
                    staticStyles.fileIcon,
                    mine && staticStyles.onAccentText,
                ]}
            >
                📎
            </Text>
            <View style={staticStyles.fileBody}>
                <Text
                    style={[
                        staticStyles.fileName,
                        mine && staticStyles.onAccentText,
                    ]}
                    numberOfLines={1}
                    ellipsizeMode="middle"
                >
                    {attachment.name}
                </Text>
                <Text
                    style={[
                        staticStyles.fileMeta,
                        mine && staticStyles.fileMetaMine,
                    ]}
                    numberOfLines={1}
                >
                    {fileTypeLabel(attachment.name, attachment.mimeType)} ·{' '}
                    {formatFileSize(attachment.size)}
                </Text>
            </View>
        </View>
    );
}

const staticStyles = StyleSheet.create({
    voiceRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
    },
    voiceButton: {
        width: 34,
        height: 34,
        borderRadius: radii.full,
        alignItems: 'center',
        justifyContent: 'center',
    },
    voiceButtonMine: { backgroundColor: 'rgba(255,255,255,0.16)' },
    voiceButtonTheirs: { backgroundColor: palette.primary[100] },
    voiceGlyph: { color: palette.primary[600], fontSize: 13 },
    onAccentText: { color: palette.text.onAccent },
    waveform: {
        flex: 1,
        minWidth: 96,
        height: 30,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 1.5,
    },
    bar: { width: 2, borderRadius: 2 },
    speed: {
        color: palette.primary[700],
        fontSize: 10,
        fontWeight: '700',
        paddingHorizontal: 4,
    },
    time: {
        color: palette.text.muted,
        fontSize: 10,
        minWidth: 30,
        textAlign: 'right',
    },
    grid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 4,
        marginTop: spacing.xxs,
    },
    tile: {
        borderRadius: radii.sm,
        overflow: 'hidden',
        backgroundColor: palette.neutral[100],
    },
    image: { width: '100%', height: '100%' },
    playBadge: {
        position: 'absolute',
        top: '50%',
        left: '50%',
        width: 36,
        height: 36,
        marginTop: -18,
        marginLeft: -18,
        borderRadius: radii.full,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(28, 32, 36, 0.58)',
    },
    playIcon: { color: palette.text.onAccent, fontSize: 15, marginLeft: 2 },
    countOverlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(28, 32, 36, 0.55)',
    },
    countText: {
        color: palette.text.onAccent,
        fontSize: 20,
        fontWeight: '700',
    },
    fileRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        paddingVertical: spacing.xs,
        paddingHorizontal: spacing.xs,
    },
    fileIcon: { fontSize: 20, color: palette.primary[700] },
    fileBody: { flex: 1, minWidth: 0, gap: 1 },
    fileName: {
        color: palette.text.primary,
        fontSize: 13,
        fontWeight: '600',
    },
    fileMeta: { color: palette.text.muted, fontSize: 11 },
    fileMetaMine: { color: 'rgba(255,255,255,0.82)' },
});

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
        borderRadius: radii.lg,
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xs,
        backgroundColor: palette.elevated,
        borderColor: palette.border.subtle,
        borderWidth: 1,
    },
    mine: {
        backgroundColor: palette.primary[500],
        borderColor: palette.border.accent,
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
    forwardTextMine: { color: 'rgba(255,255,255,0.85)' },
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
        borderColor: palette.border.strong,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: palette.glass.elevated,
    },
    selectionOn: {
        backgroundColor: palette.primary[500],
        borderColor: palette.primary[500],
    },
    selectionMark: {
        color: palette.text.onAccent,
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
    quoteMine: { backgroundColor: 'rgba(255,255,255,0.18)' },
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
    quoteNameMine: { color: 'rgba(255,255,255,0.9)' },
    quoteText: { color: palette.text.secondary, fontSize: 12 },
    quoteTextMine: { color: 'rgba(255,255,255,0.88)' },
    quoteDeleted: { fontStyle: 'italic' },
    content: { color: palette.text.primary, fontSize: 15 },
    contentMine: { color: palette.text.onAccent },
    link: {
        color: palette.primary[700],
        textDecorationLine: 'underline',
    },
    linkMine: {
        color: palette.text.onAccent,
        textDecorationLine: 'underline',
    },
    caption: { marginTop: spacing.xxs },
    reactionRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: spacing.xxs,
        marginTop: spacing.xxs,
        maxWidth: '100%',
    },
    reactionChip: {
        borderRadius: radii.sm,
        borderWidth: 1,
        paddingHorizontal: spacing.xs,
        paddingVertical: 2,
    },
    reactionMine: {
        backgroundColor: 'rgba(255,255,255,0.18)',
        borderColor: 'rgba(255,255,255,0.28)',
    },
    reactionMineSelected: {
        backgroundColor: palette.primary[100],
        borderColor: palette.neutral[0],
    },
    reactionTheirs: {
        backgroundColor: palette.neutral[100],
        borderColor: palette.neutral[100],
    },
    reactionTheirsSelected: {
        backgroundColor: palette.primary[500],
        borderColor: palette.primary[600],
    },
    reactionText: { fontSize: 12, fontWeight: '600' },
    reactionTextMine: { color: palette.text.onAccent },
    reactionTextMineSelected: { color: palette.highlight },
    reactionTextTheirs: { color: palette.text.secondary },
    reactionTextTheirsSelected: { color: palette.text.onAccent },
    uploadError: {
        color: palette.semantic.danger,
        fontSize: 11,
        marginTop: 2,
    },
    uploadErrorMine: { color: 'rgba(255,255,255,0.8)' },
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
    pendingButtonTextMine: { color: palette.text.onAccent },
    meta: {
        color: palette.neutral[500],
        fontSize: 10,
        textAlign: 'right',
        marginTop: 2,
    },
    metaMine: { color: 'rgba(255,255,255,0.72)' },
    ticks: { fontSize: 10 },
    ticksSeen: { color: palette.text.onAccent, fontWeight: '700' },
    unreadRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        marginVertical: spacing.sm,
    },
    unreadLine: { flex: 1, height: 1, backgroundColor: palette.border.strong },
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
