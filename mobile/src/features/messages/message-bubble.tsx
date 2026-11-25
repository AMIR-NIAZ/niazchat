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
import Reanimated from 'react-native-reanimated';
import { SafeText, UserAvatar,
    AppText,
} from '../../shared/components';
import { palette, radii, spacing } from '../../shared/theme';
import { LONG_PRESS_DELAY_MS } from '../../shared/long-press';
import { measureInWindow, usePopupHidden } from '../../shared/context-popup';
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
import { fileTypeLabel } from '../attachments/file-name';
import { formatDuration } from '../attachments/duration';
import type { ViewerRect } from '../attachments/viewer/viewer-model';
import { AttachmentGrid } from '../attachments/attachment-grid';
import { AttachmentFileRow } from '../attachments/attachment-file-row';
import { VoiceBubble } from '../voice/voice-bubble';
import { MusicBubble } from '../music/music-bubble';
import type { MusicTrack } from '../../shared/music-player';
import { splitLinkifiedText } from '../groups/invite-links-model';
import type { LinkifiedSegment } from '../groups/invite-links-model';
import { parseMentions } from './mentions';
import type { MentionSegment } from './mentions';
import { childPressBlocksMenu, resolveBubblePress } from './bubble-press';
import { Check, CheckCheck, Clock3 } from 'lucide-react-native';
import { MessageHighlight } from './message-highlight';
import { useTheme, useThemedStyles } from '../../shared/theme';
import type { AppTheme } from '../../shared/theme';
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
    /** Opens the profile of a user mentioned as `@username` in the body. */
    onMentionPress?: ((username: string) => void) | undefined;
    /**
     * Opens the full-screen viewer at an image/video of this message. `origin`
     * is the tapped tile's window rect (the viewer's hero animation start).
     */
    onOpenMedia?:
        | ((
              message: ChatMessage,
              mediaIndex: number,
              origin: ViewerRect | null,
          ) => void)
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
    /** This chat's music tracks, ascending: the player's next/previous queue. */
    musicQueue?: MusicTrack[] | undefined;
}

/** One inline piece of message text after link + mention parsing. */
type MessageBodySegment = LinkifiedSegment | MentionSegment;

/** Bubble avatar edge length (the spacer keeps the other rows aligned). */
const AVATAR_SIZE = 45;

/** Tap and hold both open the same floating menu. */
const BUBBLE_LONG_PRESS_MS = 350;

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
        reply.attachmentTitle ?? null,
    );
}

export function MessageBubble(props: MessageBubbleProps): React.ReactElement {
    const theme = useTheme();
    const styles = useThemedStyles(createStyles);
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
        onMentionPress,
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
        musicQueue = [],
    } = props;
    // Anchor of the lifted preview: measured in window coordinates at press
    // time so the popup lands on the bubble with the keyboard open too.
    const bubbleRef = useRef<ComponentRef<typeof Reanimated.View>>(null);
    // A child control that saw this touch start keeps its own behaviour; the
    // bubble menu is suppressed for the remainder of that gesture.
    const childPressAtRef = useRef(0);
    // A long press on a mention opens the bubble menu; the matching onPress
    // (fired on release by some platforms) must not also open the profile.
    const mentionLongPressedRef = useRef(false);
    /** Inline mention currently held down, for its opacity feedback. */
    const [pressedMentionIndex, setPressedMentionIndex] = useState<
        number | null
    >(null);
    const markChildPress = useCallback((): void => {
        childPressAtRef.current = Date.now();
    }, []);

    const showMenu =
        !selectionMode && message.status === 'sent' && message.id !== null;

    // While the popup is open it draws a copy of THIS bubble on top; the live
    // one is hidden (opacity only) through a shared value, so the same element
    // appears to lift. Nothing here re-renders when the popup opens or closes.
    const hiddenStyle = usePopupHidden(message.key);

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

    // Split once per content change: links first, then mentions inside each
    // plain-text piece so both stay tappable. Plain text is the untapped case.
    const contentSegments = useMemo<MessageBodySegment[]>(() => {
        if (message.content === null) {
            return [];
        }
        const segments: MessageBodySegment[] = [];
        for (const segment of splitLinkifiedText(message.content)) {
            if (segment.type === 'text') {
                segments.push(...parseMentions(segment.text));
            } else {
                segments.push(segment);
            }
        }
        return segments;
    }, [message.content]);
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
    const musicAttachments = message.attachments.filter(
        (attachment) => attachment.kind === 'music',
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
        // The bubble's OWN node carries the popup hide. It is a Reanimated
        // view only so the opacity can be animated; it has exactly the same
        // position in the tree, so the row's layout cannot change. `isStatic`
        // is the popup copy: it must never hide itself.
        <Reanimated.View
            ref={bubbleRef}
            collapsable={false}
            style={[
                styles.bubble,
                mine ? styles.mine : styles.theirs,
                showFailedHint && styles.failed,
                selected && styles.selectedBubble,
                isStatic ? null : hiddenStyle,
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
                    <SafeText
                        style={[
                            styles.forwardText,
                            mine && styles.forwardTextMine,
                        ]}
                        lines={1}
                        align="content"
                    >
                        ↗ Forwarded from {forwarded.name || 'unknown'}
                    </SafeText>
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
                            <SafeText
                                style={[
                                    styles.quoteName,
                                    mine && styles.quoteNameMine,
                                ]}
                                lines={1}
                                align="content"
                            >
                                {replyName}
                            </SafeText>
                        )}
                        <AppText
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
                        </AppText>
                    </View>
                </Pressable>
            )}
            {showSender &&
                (onOpenProfile === undefined ? (
                    <SafeText
                        lines={1}
                        style={styles.senderName}
                        align="content"
                    >
                        {message.senderName}
                    </SafeText>
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
                        <SafeText
                            lines={1}
                            style={styles.senderName}
                            align="content"
                        >
                            {message.senderName}
                        </SafeText>
                    </Pressable>
                ))}
            {message.attachments.length > 0 && (
                <View style={styles.attachmentsWrap}>
                    {musicAttachments.map((attachment) => (
                        <MusicBubble
                            key={attachment.key}
                            attachment={attachment}
                            messageKey={message.key}
                            mine={mine}
                            queue={musicQueue}
                            isStatic={isStatic}
                            onLongPress={childLongPress}
                        />
                    ))}
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
                    {mediaAttachments.length > 0 && (
                        <AttachmentGrid
                            attachments={mediaAttachments}
                            static={isStatic}
                            onOpenMedia={(mediaIndex, origin): void =>
                                onOpenMedia?.(message, mediaIndex, origin)
                            }
                            onLongPress={childLongPress}
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
                <AppText
                    style={[styles.uploadError, mine && styles.uploadErrorMine]}
                >
                    {failedAttachmentReason}
                </AppText>
            )}
            {message.content !== null && message.content !== '' && (
                <AppText
                    style={[
                        styles.content,
                        mine && styles.contentMine,
                        message.attachments.length > 0 && styles.caption,
                    ]}
                >
                    {contentSegments.map((segment, index) => {
                        if (segment.type === 'text') {
                            return <AppText key={index}>{segment.text}</AppText>;
                        }
                        if (segment.type === 'link') {
                            return (
                                <AppText
                                    key={index}
                                    accessibilityRole="link"
                                    accessibilityLabel={segment.url}
                                    style={[
                                        styles.link,
                                        mine && styles.linkMine,
                                    ]}
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
                                </AppText>
                            );
                        }
                        return (
                            <AppText
                                key={index}
                                accessibilityRole="link"
                                accessibilityLabel={`Open ${segment.username}'s profile`}
                                accessibilityHint="Opens the user profile"
                                style={[
                                    styles.mention,
                                    mine && styles.mentionMine,
                                    onMentionPress !== undefined &&
                                        pressedMentionIndex === index &&
                                        styles.mentionPressed,
                                ]}
                                suppressHighlighting={true}
                                onPressIn={
                                    onMentionPress === undefined
                                        ? undefined
                                        : (): void => {
                                              mentionLongPressedRef.current = false;
                                              setPressedMentionIndex(index);
                                              markChildPress();
                                          }
                                }
                                onPressOut={
                                    onMentionPress === undefined
                                        ? undefined
                                        : (): void => {
                                              setPressedMentionIndex(
                                                  (current) =>
                                                      current === index
                                                          ? null
                                                          : current,
                                              );
                                          }
                                }
                                onLongPress={
                                    onMentionPress === undefined
                                        ? undefined
                                        : (): void => {
                                              mentionLongPressedRef.current = true;
                                              childLongPress?.();
                                          }
                                }
                                onPress={
                                    onMentionPress === undefined
                                        ? undefined
                                        : (): void => {
                                              if (
                                                  mentionLongPressedRef.current
                                              ) {
                                                  mentionLongPressedRef.current = false;
                                                  return;
                                              }
                                              onMentionPress(segment.username);
                                          }
                                }
                            >
                                {segment.text}
                            </AppText>
                        );
                    })}
                </AppText>
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
                                <AppText
                                    style={[
                                        styles.pendingButtonText,
                                        mine && styles.pendingButtonTextMine,
                                    ]}
                                >
                                    Retry
                                </AppText>
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
                                <AppText
                                    style={[
                                        styles.pendingButtonText,
                                        mine && styles.pendingButtonTextMine,
                                    ]}
                                >
                                    Remove
                                </AppText>
                            </Pressable>
                        )}
                    {uploadingAttachments && onCancelPending !== undefined && (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Cancel uploading message"
                            onPress={(): void => onCancelPending(message)}
                            style={styles.pendingButton}
                        >
                            <AppText
                                style={[
                                    styles.pendingButtonText,
                                    mine && styles.pendingButtonTextMine,
                                ]}
                            >
                                Cancel
                            </AppText>
                        </Pressable>
                    )}
                </View>
            )}
            <View style={[styles.metaRow, mine && styles.metaRowMine]}>
                <AppText style={[styles.meta, mine && styles.metaMine]}>
                    {formatMessageTime(message.createdAtIso)}
                    {message.isEdited ? ' · edited' : ''}
                    {isSending ? ' · sending' : ''}
                    {showFailedHint ? ' · not sent' : ''}
                </AppText>

                {mine && !showFailedHint && (
                    <View
                        accessibilityLabel={
                            seenByOthers
                                ? 'Seen'
                                : isSending
                                  ? 'Sending'
                                  : 'Sent'
                        }
                        style={styles.ticks}
                    >
                        {isSending ? (
                            <Clock3 size={13} color={theme.colors.textSecondary} />
                        ) : seenByOthers ? (
                            <CheckCheck
                                size={15}
                                color={theme.colors.accentText}
                            />
                        ) : (
                            <Check size={15} color={theme.colors.accentText} />
                        )}
                    </View>
                )}
            </View>
            {/* Jump-target wash: absolutely positioned, never affects layout.
                Mounting it only for the target also replaces the previous
                animation instead of letting two washes compete. */}
            {highlighted && <MessageHighlight mine={mine} />}
        </Reanimated.View>
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
                <AppText style={styles.selectionMark}>{selected ? '✓' : ''}</AppText>
            </View>
            <View style={styles.selectionBody}>{bubbleBody}</View>
        </View>
    ) : (
        bubbleBody
    );

    // Private chats and my own messages keep the original full-width layout.
    if (!isGroup || mine) {
        return (
            <View
                style={[
                    styles.row,
                    mine && styles.rowMine,
                    isStatic && styles.rowStatic,
                ]}
            >
                {withSelection}
            </View>
        );
    }

    return (
        <View
            style={[styles.row, styles.groupRow, isStatic && styles.rowStatic]}
        >
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
    const styles = useThemedStyles(createStyles);
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
                        <AppText
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
                        </AppText>
                    </Pressable>
                );
            })}
        </Animated.View>
    );
}

/** Divider shown where the user's unread messages start (when the chat opens). */
export function UnreadDivider(): React.ReactElement {
    const styles = useThemedStyles(createStyles);
    return (
        <View style={styles.unreadRow}>
            <View style={styles.unreadLine} />
            <AppText style={styles.unreadLabel}>New messages</AppText>
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
    const styles = useThemedStyles(createStyles);
    return (
        <View style={styles.separatorRow}>
            <View style={styles.separatorLine} />
            <AppText style={styles.separatorLabel}>{label}</AppText>
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
    const theme = useTheme();
    const staticStyles = useThemedStyles(createStaticStyles);
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
                <AppText
                    style={[
                        staticStyles.voiceGlyph,
                        mine && staticStyles.onAccentText,
                    ]}
                >
                    ▶
                </AppText>
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
                                    ? theme.colors.bubbleOwnMuted
                                    : theme.colors.textMuted,
                            },
                        ]}
                    />
                ))}
            </View>
            <AppText
                style={[staticStyles.speed, mine && staticStyles.onAccentText]}
            >
                1x
            </AppText>
            <AppText
                style={[staticStyles.time, mine && staticStyles.onAccentText]}
            >
                {formatDuration(duration)}
            </AppText>
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
    const theme = useTheme();
    const staticStyles = useThemedStyles(createStaticStyles);
    return (
        <View style={staticStyles.fileRow}>
            <AppText
                style={[
                    staticStyles.fileIcon,
                    mine && staticStyles.onAccentText,
                ]}
            >
                📎
            </AppText>
            <View style={staticStyles.fileBody}>
                <AppText
                    style={[
                        staticStyles.fileName,
                        mine && staticStyles.onAccentText,
                    ]}
                    numberOfLines={1}
                    ellipsizeMode="middle"
                >
                    {attachment.name}
                </AppText>
                <AppText
                    style={[
                        staticStyles.fileMeta,
                        mine && staticStyles.fileMetaMine,
                    ]}
                    numberOfLines={1}
                >
                    {fileTypeLabel(attachment.name, attachment.mimeType)} ·{' '}
                    {formatFileSize(attachment.size)}
                </AppText>
            </View>
        </View>
    );
}

const createStaticStyles = (theme: AppTheme) =>
    StyleSheet.create({
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
    voiceButtonMine: { backgroundColor: theme.colors.quoteOwn },
    voiceButtonTheirs: { backgroundColor: theme.colors.accentSoft },
    voiceGlyph: { color: theme.accent, fontSize: 13 },
    onAccentText: { color: theme.colors.accentText },
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
        color: theme.accent,
        fontSize: 10,
        fontWeight: '700',
        paddingHorizontal: 4,
    },
    time: {
        color: theme.colors.textMuted,
        fontSize: 10,
        minWidth: 30,
        textAlign: 'right',
    },
    fileRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        paddingVertical: spacing.xs,
        paddingHorizontal: spacing.xs,
    },
    fileIcon: { fontSize: 20, color: theme.accent },
    fileBody: { flex: 1, minWidth: 0, gap: 1 },
    fileName: {
        color: theme.colors.text,
        fontSize: 13,
        fontWeight: '600',
    },
    fileMeta: { color: theme.colors.textMuted, fontSize: 11 },
    fileMetaMine: { color: theme.colors.bubbleOwnMuted },
});

const createStyles = (theme: AppTheme) =>
    StyleSheet.create({
    row: {
        alignSelf: 'flex-start',
        maxWidth: '85%',
        marginVertical: spacing.xxs,
    },
    rowMine: { alignSelf: 'flex-end' },
    // Lifted copy: its wrapper is already the bubble's measured width.
    rowStatic: { maxWidth: '100%' },
    groupRow: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: spacing.xs,
    },
    avatarSlot: { width: AVATAR_SIZE },
    bubbleSlot: { flexShrink: 1, minWidth: 0 },
    bubble: {
        borderRadius: radii.lg,
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xs,
        backgroundColor: theme.colors.glassElevated,
        borderColor: theme.colors.border,
        borderWidth: 1,
    },
    mine: {
        backgroundColor: theme.accent,
        borderColor: theme.colors.accentBorder,
        borderBottomRightRadius: 4,
    },
    theirs: { borderBottomLeftRadius: 4 },
    failed: { opacity: 0.65 },
    pressed: { opacity: 0.6 },
    selectedBubble: {
        borderColor: theme.accent,
        borderWidth: 2,
    },
    forwardHeader: { marginBottom: 3 },
    forwardText: {
        color: theme.accent,
        fontSize: 11,
        fontWeight: '700',
    },
    forwardTextMine: { color: theme.colors.bubbleOwnMuted },
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
        borderColor: theme.colors.borderStrong,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.glassElevated,
    },
    selectionOn: {
        backgroundColor: theme.accent,
        borderColor: theme.accent,
    },
    selectionMark: {
        color: theme.colors.accentText,
        fontSize: 13,
        fontWeight: '700',
    },
    senderName: {
        fontSize: 12,
        fontWeight: '600',
        color: theme.accent,
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
    quoteTheirs: { backgroundColor: theme.colors.surface },
    quoteMine: { backgroundColor: theme.colors.quoteOwn },
    quoteBar: { width: 3 },
    quoteBarTheirs: { backgroundColor: theme.accent },
    quoteBarMine: { backgroundColor: theme.colors.accentSoft },
    quoteBody: {
        flexShrink: 1,
        minWidth: 0,
        paddingHorizontal: spacing.xs,
        paddingVertical: spacing.xxs,
    },
    quoteName: {
        color: theme.accent,
        fontSize: 11,
        fontWeight: '700',
    },
    quoteNameMine: { color: theme.colors.bubbleOwnText },
    quoteText: { color: theme.colors.textSecondary, fontSize: 12 },
    quoteTextMine: { color: theme.colors.bubbleOwnMuted },
    quoteDeleted: { fontStyle: 'italic' },
    content: { color: theme.colors.text, fontSize: 15 },
    contentMine: { color: theme.colors.accentText },
    link: {
        color: theme.accent,
        textDecorationLine: 'underline',
    },
    linkMine: {
        color: theme.colors.accentText,
        textDecorationLine: 'underline',
    },
    // Mentions use the standard link blue on neutral bubbles and a lighter
    // blue on the purple own-bubble surface (both pass 4.5:1). The app is
    // dark-only; underline matches the existing message-link style.
    mention: {
        color: theme.colors.link,
        fontWeight: '600',
        textDecorationLine: 'underline',
    },
    mentionMine: {
        color: theme.colors.linkOnOwn,
    },
    mentionPressed: {
        opacity: 0.6,
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
        backgroundColor: theme.colors.quoteOwn,
        borderColor: theme.colors.quoteOwn,
    },
    reactionMineSelected: {
        backgroundColor: theme.colors.accentSoft,
        borderColor: theme.colors.background,
    },
    reactionTheirs: {
        backgroundColor: theme.colors.glassElevated,
        borderColor: theme.colors.border,
    },
    reactionTheirsSelected: {
        backgroundColor: theme.accent,
        borderColor: theme.accent,
    },
    reactionText: { fontSize: 12, fontWeight: '600' },
    reactionTextMine: { color: theme.colors.accentText },
    reactionTextMineSelected: { color: theme.accent },
    reactionTextTheirs: { color: theme.colors.textSecondary },
    reactionTextTheirsSelected: { color: theme.colors.accentText },
    uploadError: {
        color: theme.colors.danger,
        fontSize: 11,
        marginTop: 2,
    },
    uploadErrorMine: { color: theme.colors.bubbleOwnMuted },
    attachmentsWrap: { maxWidth: 260, width: '100%' },
    filesBlock: {
        borderRadius: radii.sm,
        overflow: 'hidden',
        marginTop: spacing.xxs,
    },
    filesBlockMine: { backgroundColor: theme.colors.quoteOwn },
    filesBlockTheirs: { backgroundColor: theme.colors.surface },
    fileDivider: {
        height: StyleSheet.hairlineWidth,
        backgroundColor: theme.colors.glassElevated,
        marginHorizontal: spacing.xs,
    },
    fileDividerMine: { backgroundColor: theme.colors.quoteOwn },
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
        backgroundColor: theme.colors.quoteOther,
    },
    pendingButtonText: {
        color: theme.colors.text,
        fontSize: 11,
        fontWeight: '700',
    },
    pendingButtonTextMine: { color: theme.colors.accentText },
    meta: {
        color: theme.colors.textSecondary,
        fontSize: 10,
        textAlign: 'right',
        marginTop: 2,
    },
    metaMine: { color: theme.colors.bubbleOwnMuted },
    ticksSeen: { color: theme.colors.accentText, fontWeight: '700' },
    unreadRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        marginVertical: spacing.sm,
    },
    unreadLine: { flex: 1, height: 1, backgroundColor: theme.colors.borderStrong },
    unreadLabel: {
        color: theme.accent,
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
        backgroundColor: theme.colors.glassElevated,
    },
    separatorLabel: { color: theme.colors.textSecondary, fontSize: 12 },
    metaRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 3,
        marginTop: 2,
    },
    metaRowMine: {
        alignSelf: 'flex-end',
    },
    ticks: {
        alignItems: 'center',
        justifyContent: 'center',
        transform: [{ translateY: 1 }],
    },
});
