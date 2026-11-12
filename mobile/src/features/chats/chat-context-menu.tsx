import { useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Modal,
    Pressable,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError } from '../../core/api';
import { UserAvatar } from '../../shared/components';
import { palette, radii, spacing, typography } from '../../shared/theme';
import { markChatSeen } from '../messages/messages-socket-api';
import { purgeChatFromCaches } from './chats-cache';
import type { ChatPreview } from './chats-model';
import { getChatDisplay, isGroupOwner, isPrivateChat } from './chats-model';
import { setChatUnreadCount } from './use-chats';
import { useLeaveGroup, useMyChatRole } from './use-groups';

/**
 * Long-press chat menu (bottom sheet).
 *
 * Only actions backed by real behavior are rendered:
 * - Pin/Unpin: device-local (the backend has no pin field) — see
 *   `local-chat-prefs.ts`.
 * - Mark as read: WS `markSeen` with the previewed last message id (monotonic
 *   server-side). Hidden when there is nothing unread or no message.
 * - Leave group: groups only, the real `POST /chats/:chatId/leave`. The owner
 *   (`manager` chat role, never `admin`) is shown an explanation instead, and
 *   the backend rejects the action regardless.
 * Mute and delete-chat are not rendered: the backend has no notification
 * preferences and no per-user chat deletion.
 */

interface ChatContextMenuProps {
    /** Null = closed. Kept mounted so the Modal can animate out. */
    chat: ChatPreview | null;
    pinned: boolean;
    onClose: () => void;
    onTogglePin: (chatId: number) => void;
}

export function ChatContextMenu(
    props: ChatContextMenuProps,
): React.ReactElement {
    const insets = useSafeAreaInsets();
    const queryClient = useQueryClient();
    const chat = props.chat;
    const chatId = chat === null ? null : Number(chat.id);
    const isGroup = chat !== null && !isPrivateChat(chat);
    const roleQuery = useMyChatRole(chatId, isGroup);
    const leaveGroup = useLeaveGroup();
    const [marking, setMarking] = useState(false);
    const [feedback, setFeedback] = useState<string | null>(null);
    const leaveInFlightRef = useRef(false);

    // A different selection starts with fresh feedback.
    useEffect((): void => {
        setFeedback(null);
        setMarking(false);
    }, [chatId]);

    const busy = leaveGroup.isPending || marking;
    const role = roleQuery.data ?? null;
    const display = chat === null ? null : getChatDisplay(chat);
    const name = display?.title ?? '';
    const avatarUrl = display?.avatarUri ?? null;

    const markRead = async (): Promise<void> => {
        if (chat === null || chat.lastMessage === null || marking) {
            return;
        }
        setMarking(true);
        setFeedback(null);
        try {
            await markChatSeen(Number(chat.id), chat.lastMessage.id);
            setChatUnreadCount(queryClient, Number(chat.id), 0);
            props.onClose();
        } catch (error) {
            setFeedback(
                error instanceof Error
                    ? error.message
                    : 'Could not mark as read.',
            );
        } finally {
            setMarking(false);
        }
    };

    const performLeave = async (): Promise<void> => {
        if (chat === null || leaveInFlightRef.current) {
            return;
        }
        leaveInFlightRef.current = true;
        setFeedback(null);
        try {
            await leaveGroup.mutateAsync(Number(chat.id));
            purgeChatFromCaches(queryClient, Number(chat.id));
            props.onClose();
            Alert.alert(
                'Left group',
                'You are no longer a member of this group.',
            );
        } catch (error) {
            // 403/404: membership is already gone server-side — drop local
            // access the same way instead of leaving a dead row behind.
            if (
                error instanceof ApiError &&
                (error.statusCode === 403 || error.statusCode === 404)
            ) {
                purgeChatFromCaches(queryClient, Number(chat.id));
                props.onClose();
                Alert.alert(
                    'Left group',
                    'You are no longer a member of this group.',
                );
                return;
            }
            setFeedback(
                error instanceof Error
                    ? error.message
                    : 'Could not leave the group.',
            );
        } finally {
            leaveInFlightRef.current = false;
        }
    };

    const confirmLeave = (): void => {
        if (chat === null || busy || leaveInFlightRef.current) {
            return;
        }
        Alert.alert(
            'Leave group?',
            'You will be removed from this group and will no longer receive its messages. An admin will have to add you again.',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Leave',
                    style: 'destructive',
                    onPress: (): void => {
                        void performLeave();
                    },
                },
            ],
        );
    };

    return (
        <Modal
            visible={chat !== null}
            transparent={true}
            animationType="slide"
            statusBarTranslucent={true}
            onRequestClose={props.onClose}
        >
            <Pressable style={styles.backdrop} onPress={props.onClose}>
                <Pressable
                    accessibilityViewIsModal={true}
                    style={[
                        styles.sheet,
                        { paddingBottom: Math.max(insets.bottom, spacing.md) },
                    ]}
                >
                    {chat !== null && (
                        <>
                            <View style={styles.header}>
                                <UserAvatar
                                    userId={display?.userId ?? Number(chat.id)}
                                    name={name}
                                    uri={avatarUrl}
                                    size={44}
                                />
                                <View style={styles.headerBody}>
                                    <Text
                                        style={styles.headerName}
                                        numberOfLines={1}
                                    >
                                        {name}
                                    </Text>
                                    <Text style={styles.headerMeta}>
                                        {isGroup
                                            ? 'Group chat'
                                            : 'Private chat'}
                                    </Text>
                                </View>
                            </View>

                            <View style={styles.divider} />

                            <MenuRow
                                icon="📌"
                                label={props.pinned ? 'Unpin chat' : 'Pin chat'}
                                disabled={busy}
                                onPress={(): void => {
                                    props.onTogglePin(Number(chat.id));
                                    props.onClose();
                                }}
                            />

                            {chat.unreadCount > 0 &&
                                chat.lastMessage !== null && (
                                    <MenuRow
                                        icon="✓"
                                        label={
                                            marking
                                                ? 'Marking as read…'
                                                : 'Mark as read'
                                        }
                                        disabled={busy}
                                        onPress={(): void => {
                                            void markRead();
                                        }}
                                    />
                                )}

                            {isGroup && roleQuery.isPending && (
                                <View style={styles.pendingRow}>
                                    <ActivityIndicator
                                        size="small"
                                        color={palette.primary[500]}
                                    />
                                    <Text style={styles.pendingText}>
                                        Checking your role…
                                    </Text>
                                </View>
                            )}

                            {isGroup && role !== null && (
                                <View style={styles.destructiveSection}>
                                    {isGroupOwner(role) ? (
                                        <View style={styles.ownerNote}>
                                            <Text style={styles.ownerNoteText}>
                                                🔒 The group owner cannot leave
                                                this group.
                                            </Text>
                                            <Text
                                                style={styles.ownerNoteDetail}
                                            >
                                                Ownership transfer is not
                                                supported.
                                            </Text>
                                        </View>
                                    ) : (
                                        <MenuRow
                                            icon="🚪"
                                            label={
                                                leaveGroup.isPending
                                                    ? 'Leaving…'
                                                    : 'Leave group'
                                            }
                                            danger={true}
                                            disabled={busy}
                                            onPress={confirmLeave}
                                        />
                                    )}
                                </View>
                            )}

                            {feedback !== null && (
                                <Text style={styles.error}>{feedback}</Text>
                            )}

                            <Pressable
                                accessibilityRole="button"
                                style={styles.cancel}
                                onPress={props.onClose}
                            >
                                <Text style={styles.cancelText}>Cancel</Text>
                            </Pressable>
                        </>
                    )}
                </Pressable>
            </Pressable>
        </Modal>
    );
}

function MenuRow(props: {
    icon: string;
    label: string;
    onPress: () => void;
    danger?: boolean;
    disabled?: boolean;
}): React.ReactElement {
    const disabled = props.disabled === true;
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={props.onPress}
            style={({ pressed }) => [
                styles.row,
                pressed && !disabled && styles.rowPressed,
                disabled && styles.rowDisabled,
            ]}
        >
            <Text style={styles.rowIcon}>{props.icon}</Text>
            <Text
                style={[
                    styles.rowLabel,
                    props.danger === true && styles.rowLabelDanger,
                ]}
            >
                {props.label}
            </Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
        justifyContent: 'flex-end',
        backgroundColor: 'rgba(0,0,0,0.4)',
    },
    sheet: {
        gap: spacing.xxs,
        paddingTop: spacing.sm,
        paddingHorizontal: spacing.sm,
        borderTopLeftRadius: radii.lg,
        borderTopRightRadius: radii.lg,
        backgroundColor: palette.elevated,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        paddingHorizontal: spacing.xs,
        paddingVertical: spacing.xs,
    },
    avatar: { width: 44, height: 44, borderRadius: radii.full / 2 },
    avatarFallback: {
        width: 44,
        height: 44,
        borderRadius: radii.full / 2,
        backgroundColor: palette.primary[100],
        alignItems: 'center',
        justifyContent: 'center',
    },
    avatarFallbackText: {
        color: palette.primary[700],
        fontSize: 16,
        fontWeight: '700',
    },
    headerBody: { flex: 1, gap: 2 },
    headerName: {
        fontSize: 16,
        fontWeight: '700',
        color: palette.neutral[900],
    },
    headerMeta: { ...typography.caption },
    divider: {
        height: StyleSheet.hairlineWidth,
        marginHorizontal: spacing.xs,
        backgroundColor: palette.neutral[100],
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        minHeight: 48,
        paddingHorizontal: spacing.xs,
        borderRadius: radii.sm,
    },
    rowPressed: { backgroundColor: palette.neutral[100] },
    rowDisabled: { opacity: 0.45 },
    rowIcon: { width: 22, fontSize: 16, textAlign: 'center' },
    rowLabel: {
        flex: 1,
        fontSize: 15,
        fontWeight: '600',
        color: palette.neutral[900],
    },
    rowLabelDanger: { color: palette.semantic.danger },
    destructiveSection: {
        marginTop: spacing.xxs,
        paddingTop: spacing.xxs,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: palette.neutral[100],
    },
    ownerNote: {
        gap: 2,
        paddingHorizontal: spacing.xs,
        paddingVertical: spacing.xs,
    },
    ownerNoteText: {
        fontSize: 14,
        fontWeight: '600',
        color: palette.neutral[700],
    },
    ownerNoteDetail: { ...typography.caption },
    pendingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        minHeight: 44,
        paddingHorizontal: spacing.xs,
    },
    pendingText: { ...typography.caption },
    error: {
        ...typography.caption,
        color: palette.semantic.danger,
        paddingHorizontal: spacing.xs,
        paddingVertical: spacing.xxs,
    },
    cancel: {
        minHeight: 48,
        marginTop: spacing.xxs,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radii.sm,
    },
    cancelText: {
        fontSize: 15,
        fontWeight: '600',
        color: palette.neutral[500],
    },
});
