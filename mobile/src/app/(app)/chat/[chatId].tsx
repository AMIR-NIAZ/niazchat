import { useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Image,
    Keyboard,
    KeyboardAvoidingView,
    Modal,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import {
    AppText,
    Screen,
    palette,
    radii,
    spacing,
    typography,
} from '../../../shared/components';
import { absoluteUploadUrl } from '../../../core/config/env';
import {
    DateSeparator,
    MessageBubble,
    MessageComposer,
    useChatMessages,
    formatDaySeparator,
} from '../../../features/messages';
import type { ChatMessage } from '../../../features/messages';
import {
    useAddMemberByPhone,
    useBannedMembers,
    useLeaveChatRoomOnUnmount,
} from '../../../features/chats';
import { useMe } from '../../../features/users';

/**
 * Conversation screen (chat list → tap → this screen).
 *
 * Implemented strictly from the documented backend surface:
 * - `joinChat` + `chatInfo` via WS (title/type/avatar/ban state).
 * - History via `getMessages` (last 50 — the backend has NO pagination).
 * - Live messaging over `sendMessage`/`sendMessage:list`,
 *   `editMessage`/`editMessage:list`, `deleteMessage`/`deleteMessage:list`.
 * - Member management (add-by-phone, banned list) kept from the previous
 *   screen revision, now behind the header admin toggle.
 *
 * Unavailable server-side (not shown): member list for normal members, roles,
 * group rename, read receipts per user, reactions (broken server-side).
 */

type ChatDetailRouteParams = { chatId?: string | string[] };
type ListChunk =
    | { kind: 'message'; message: ChatMessage }
    | { kind: 'day'; key: string; label: string };

export default function ChatDetailScreen(): React.ReactElement {
    const params = useLocalSearchParams<ChatDetailRouteParams>();
    const chatId =
        typeof params.chatId === 'string' ? Number(params.chatId) : Number.NaN;
    const isValid = Number.isInteger(chatId) && chatId > 0;

    // Leaves the chat room on unmount (server triggers `typing:stop` + `seen`).
    useLeaveChatRoomOnUnmount(isValid ? chatId : 0);

    if (!isValid) {
        return <InvalidChat />;
    }
    return <ChatDetail chatId={chatId} />;
}

function ChatDetail({ chatId }: { chatId: number }): React.ReactElement {
    const me = useMe();
    const currentUserId = me.me?.id ?? null;
    const conversation = useChatMessages(chatId, true, currentUserId);
    const [adminPanelOpen, setAdminPanelOpen] = useState(false);
    const [sheetTarget, setSheetTarget] = useState<ChatMessage | null>(null);
    const [actionTarget, setActionTarget] = useState<ChatMessage | null>(null);
    const [actionDraft, setActionDraft] = useState('');
    const [actionError, setActionError] = useState<string | null>(null);

    const detail = conversation.detail;
    const messages = detail?.messages ?? [];
    const info = detail?.info ?? null;
    const isGroup = info?.type !== undefined && info.type !== 'private';

    /** Ascending list with a day separator inserted before each new day. */
    const listData = useMemo<List[]>(() => {
        const list: List[] = [];
        for (const message of messages) {
            const tail = list.length > 0 ? list[list.length - 1] : undefined;
            const previousIso =
                tail?.kind === 'message' ? tail.message.createdAtIso : null;
            const dayLabel = formatDaySeparator(
                previousIso ?? message.createdAtIso,
                message.createdAtIso,
            );
            if (dayLabel !== null) {
                list.push({
                    kind: 'day',
                    key: `day-${message.createdAtIso}`,
                    label: dayLabel,
                });
            }
            list.push({ kind: 'message', message });
        }
        return list;
    }, [messages]);

    /**
     * Private chats have no server-side title; fall back to the peer's display
     * name from history senders (no user directory for PV chats exists).
     */
    const peer = isGroup
        ? null
        : (messages.find((message) => message.senderId !== currentUserId) ??
          null);
    const name =
        info?.title !== undefined && info.title !== null
            ? info.title
            : (peer?.senderName ??
              (isGroup ? 'Unnamed group' : 'Private chat'));
    const rawAvatarUrl =
        info?.avatars !== undefined && info.avatars.length > 0
            ? absoluteUploadUrl(info.avatars[0] ?? '')
            : undefined;
    const peerAvatarUrl =
        peer?.senderAvatarUrls.length !== undefined
            ? peer.senderAvatarUrls[0]
            : undefined;
    const avatarUrl = rawAvatarUrl ?? peerAvatarUrl;

    if (conversation.isLoading || me.isLoading) {
        return <LoadingBlock />;
    }
    if (me.error !== null) {
        // Without a valid current-user id every bubble would render left;
        // surface the failure instead of misaligned history.
        return (
            <ErrorBlock
                title="Could not load your profile"
                detail={me.error.message}
                onRetry={me.refetch}
            />
        );
    }
    if (conversation.error !== null || info === null) {
        return (
            <ErrorBlock
                title="Could not open the chat"
                detail={
                    conversation.error !== null
                        ? conversation.error.message
                        : 'The chat info is unavailable.'
                }
                onRetry={conversation.refetch}
            />
        );
    }

    return (
        <Screen style={styles.screen} withTopInset={true}>
            <View style={styles.header}>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Go back"
                    style={styles.backButton}
                    onPress={(): void => router.back()}
                >
                    <Text style={styles.backText}>‹</Text>
                </Pressable>
                {avatarUrl === undefined ? (
                    <View style={styles.avatarFallback}>
                        <Text style={styles.avatarFallbackText}>
                            {name.slice(0, 1).toUpperCase()}
                        </Text>
                    </View>
                ) : (
                    <Image style={styles.avatar} source={{ uri: avatarUrl }} />
                )}
                <View style={styles.headerMeta}>
                    <Text style={typography.title} numberOfLines={1}>
                        {name}
                    </Text>
                    <AppText variant="caption">
                        {isGroup ? 'Group' : 'Private'}
                        {info.isBan ? ' · banned' : ''}
                    </AppText>
                </View>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Open chat admin panel"
                    style={styles.pillButton}
                    onPress={(): void => setAdminPanelOpen(true)}
                >
                    <Text style={styles.pillText}>Admin</Text>
                </Pressable>
            </View>

            {messages.length === 0 ? (
                <View style={styles.emptyState}>
                    <AppText variant="title">No messages yet</AppText>
                    <AppText variant="caption" style={styles.emptyCaption}>
                        Say hello — messages are delivered over WebSocket.
                    </AppText>
                </View>
            ) : (
                <KeyboardAvoidingView
                    behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                    style={styles.chatArea}
                    keyboardVerticalOffset={
                        Platform.OS === 'ios' ? spacing.lg : 0
                    }
                >
                    <FlatList
                        inverted={true}
                        style={styles.list}
                        contentContainerStyle={styles.listContent}
                        keyExtractor={(chunk): string =>
                            chunk.kind === 'message'
                                ? `m-${chunk.message.key}`
                                : `d-${chunk.key}`
                        }
                        keyboardShouldPersistTaps="handled"
                        onScrollBeginDrag={(): void => Keyboard.dismiss()}
                        data={[...listData].reverse()}
                        renderItem={({ item }): React.ReactElement => {
                            if (item.kind === 'day') {
                                return (
                                    <View style={styles.daySlot}>
                                        <DateSeparator label={item.label} />
                                    </View>
                                );
                            }
                            const message = item.message;
                            // senderId is always a numeric (normalized) id;
                            // guard against placeholder (-1) / missing ids.
                            const mine =
                                currentUserId !== null &&
                                currentUserId > 0 &&
                                Number(message.senderId) === currentUserId;
                            // Own confirmed messages can be acted on (delete;
                            // edit additionally needs text type and content,
                            // decided inside the sheet).
                            // Pending/failed keep their retry/tap behavior; the
                            // client cannot know admin roles, so Delete is
                            // offered only for own messages.
                            const canAct =
                                mine &&
                                message.status === 'sent' &&
                                message.id !== null;
                            return (
                                <MessageBubble
                                    message={message}
                                    mine={mine}
                                    isGroup={isGroup}
                                    onLongPress={
                                        canAct
                                            ? (): void =>
                                                  setSheetTarget(message)
                                            : undefined
                                    }
                                    onRetryFailed={(failed): void =>
                                        conversation.retrySend(failed.key)
                                    }
                                />
                            );
                        }}
                    />
                </KeyboardAvoidingView>
            )}

            {conversation.sendError !== null && (
                <Text style={styles.sendError}>{conversation.sendError}</Text>
            )}

            <MessageComposer
                disabled={conversation.sending !== null}
                onSend={(content): void => conversation.send(content)}
            />

            <MessageActionSheet
                target={sheetTarget}
                canEdit={
                    sheetTarget !== null &&
                    sheetTarget.type === 'text' &&
                    sheetTarget.content !== null
                }
                onEdit={(): void => {
                    onActionPress(sheetTarget);
                    setSheetTarget(null);
                }}
                onDelete={(): void => {
                    const target = sheetTarget;
                    setSheetTarget(null);
                    if (target === null || target.id === null) {
                        return;
                    }
                    Alert.alert(
                        'Delete message?',
                        'This message will be removed for everyone.',
                        [
                            { text: 'Cancel', style: 'cancel' },
                            {
                                text: 'Delete',
                                style: 'destructive',
                                onPress: (): void => {
                                    const messageId = target.id;
                                    if (messageId === null) {
                                        return;
                                    }
                                    void conversation
                                        .remove(messageId)
                                        .catch((error: unknown) =>
                                            Alert.alert(
                                                'Could not delete message',
                                                error instanceof Error
                                                    ? error.message
                                                    : 'Delete failed.',
                                            ),
                                        );
                                },
                            },
                        ],
                    );
                }}
                onDismiss={(): void => setSheetTarget(null)}
            />

            <MessageActionModal
                visible={actionTarget !== null}
                target={actionTarget}
                draft={actionDraft}
                busy={conversation.mutating}
                error={actionError}
                onDraftChange={setActionDraft}
                onDismiss={(): void => {
                    setActionTarget(null);
                    setActionDraft('');
                    setActionError(null);
                }}
                onSave={(content): void => {
                    const target = actionTarget;
                    if (target === null || target.id === null) {
                        return;
                    }
                    setActionError(null);
                    conversation
                        .edit(target.id, content)
                        .then(() => {
                            setActionTarget(null);
                            setActionDraft('');
                        })
                        .catch((error: unknown) =>
                            setActionError(
                                error instanceof Error
                                    ? error.message
                                    : 'Edit failed.',
                            ),
                        );
                }}
            />

            <AdminPanel
                visible={adminPanelOpen}
                chatId={chatId}
                onClose={(): void => setAdminPanelOpen(false)}
            />
        </Screen>
    );

    function onActionPress(message: ChatMessage | null): void {
        if (message === null) {
            return;
        }
        setActionTarget(message);
        setActionDraft(message.content ?? '');
        setActionError(null);
    }
}

type List = ListChunk;

/// Long-press action sheet (Edit / Delete / Cancel) ---------------------------

interface MessageActionSheetProps {
    target: ChatMessage | null;
    /** Edit is offered only for own text messages with content. */
    canEdit: boolean;
    onEdit: () => void;
    onDelete: () => void;
    onDismiss: () => void;
}

function MessageActionSheet(
    props: MessageActionSheetProps,
): React.ReactElement {
    if (props.target === null) {
        return <View />;
    }
    return (
        <Modal
            visible={true}
            transparent={true}
            animationType="slide"
            onRequestClose={props.onDismiss}
        >
            <Pressable style={styles.sheetBackdrop} onPress={props.onDismiss}>
                <Pressable style={styles.sheetCard}>
                    {props.canEdit && (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Edit message"
                            style={styles.sheetButton}
                            onPress={props.onEdit}
                        >
                            <Text style={styles.sheetActionText}>Edit</Text>
                        </Pressable>
                    )}
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Delete message"
                        style={styles.sheetButton}
                        onPress={props.onDelete}
                    >
                        <Text style={styles.sheetDeleteText}>Delete</Text>
                    </Pressable>
                    <View style={styles.sheetDivider} />
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Cancel"
                        style={styles.sheetButton}
                        onPress={props.onDismiss}
                    >
                        <Text style={styles.sheetCancelText}>Cancel</Text>
                    </Pressable>
                </Pressable>
            </Pressable>
        </Modal>
    );
}

/// Message edit modal ----------------------------------------------------------

interface MessageActionModalProps {
    visible: boolean;
    target: ChatMessage | null;
    draft: string;
    busy: boolean;
    error: string | null;
    onDraftChange: (text: string) => void;
    onDismiss: () => void;
    onSave: (newContent: string) => void;
}

function MessageActionModal(
    props: MessageActionModalProps,
): React.ReactElement {
    if (props.target === null) {
        return <View />;
    }
    const trimmed = props.draft.trim();
    const unchanged =
        trimmed === (props.target.content ?? '').trim() || trimmed === '';
    return (
        <Modal
            visible={props.visible}
            transparent={true}
            animationType="fade"
            onRequestClose={props.onDismiss}
        >
            <Pressable style={styles.modalBackdrop} onPress={props.onDismiss}>
                <KeyboardAvoidingView
                    behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                    style={styles.modalAvoid}
                    pointerEvents="box-none"
                >
                    <Pressable style={styles.modalCard}>
                        <AppText variant="title">Edit message</AppText>
                        <TextInput
                            style={styles.modalInput}
                            value={props.draft}
                            onChangeText={props.onDraftChange}
                            multiline={true}
                            maxLength={5000}
                            autoFocus={true}
                        />
                        {props.error !== null && (
                            <Text
                                style={[typography.caption, styles.modalError]}
                            >
                                {props.error}
                            </Text>
                        )}
                        <View style={styles.modalActions}>
                            {props.busy ? (
                                <ActivityIndicator
                                    size="small"
                                    color={palette.primary[500]}
                                />
                            ) : (
                                <>
                                    <FormButtonSmall
                                        label="Save"
                                        disabled={unchanged}
                                        onPress={(): void =>
                                            props.onSave(props.draft.trim())
                                        }
                                    />
                                    <FormButtonSmall
                                        label="Cancel"
                                        onPress={props.onDismiss}
                                    />
                                </>
                            )}
                        </View>
                    </Pressable>
                </KeyboardAvoidingView>
            </Pressable>
        </Modal>
    );
}

/// Admin panel (member add by phone + banned members; previously inline) --------

interface AdminPanelProps {
    visible: boolean;
    chatId: number;
    onClose: () => void;
}

function AdminPanel({
    visible,
    chatId,
    onClose,
}: AdminPanelProps): React.ReactElement {
    const bans = useBannedMembers(chatId, visible);
    const addMember = useAddMemberByPhone();
    const [phone, setPhone] = useState('+98');
    const [addFeedback, setAddFeedback] = useState<string | null>(null);

    return (
        <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
            <Screen style={styles.adminScreen} withTopInset={true}>
                <View style={styles.adminHeader}>
                    <AppText variant="title">Chat admin</AppText>
                    <Pressable
                        accessibilityRole="button"
                        onPress={onClose}
                        style={styles.pillButton}
                    >
                        <Text style={styles.pillText}>Close</Text>
                    </Pressable>
                </View>

                <View style={styles.section}>
                    <AppText variant="title">Add member (by phone)</AppText>
                    <TextInput
                        style={styles.input}
                        value={phone}
                        onChangeText={setPhone}
                        keyboardType="phone-pad"
                        placeholder="+989123456789"
                        placeholderTextColor={palette.neutral[300]}
                    />
                    <FormButtonSmall
                        label={addMember.isPending ? 'Adding…' : 'Add member'}
                        onPress={(): void => {
                            setAddFeedback(null);
                            void addMember
                                .mutateAsync({
                                    groupId: chatId,
                                    phone: phone.trim(),
                                })
                                .then(() => setAddFeedback('Member added.'))
                                .catch((error: unknown) =>
                                    setAddFeedback(
                                        error instanceof Error
                                            ? error.message
                                            : 'Failed.',
                                    ),
                                );
                        }}
                    />
                    {addFeedback !== null && (
                        <Text style={[typography.caption, styles.feedback]}>
                            {addFeedback}
                        </Text>
                    )}
                </View>

                <View style={[styles.section, styles.sectionFlex]}>
                    <AppText variant="title">Banned members</AppText>
                    {bans.isPending ? (
                        <ActivityIndicator size="small" />
                    ) : bans.isError ? (
                        <AppText variant="caption" style={styles.feedback}>
                            {bansErrorText(bans.error)}
                        </AppText>
                    ) : (bans.data?.length ?? 0) === 0 ? (
                        <AppText variant="caption">No banned members.</AppText>
                    ) : (
                        <FlatList
                            data={bans.data}
                            keyExtractor={(item): string => String(item.id)}
                            renderItem={({ item }): React.ReactElement => (
                                <View style={styles.bannedRow}>
                                    <Text style={typography.body}>
                                        {item.user.name} · {item.user.phone}
                                    </Text>
                                </View>
                            )}
                        />
                    )}
                </View>
            </Screen>
        </Modal>
    );
}

function bansErrorText(error: Error | null): string {
    const status = (error as { statusCode?: number } | null)?.statusCode;
    return status === 403
        ? 'Not permitted — requires chat-manager rights (or chat-admin with ban_user).'
        : (error?.message ?? 'Failed to load banned members.');
}

/// Skeletons ---------------------------------------------------------------------

function FormButtonSmall(props: {
    label: string;
    onPress: () => void;
    intent?: 'primary' | 'danger';
    disabled?: boolean;
}): React.ReactElement {
    return (
        <Pressable
            accessibilityRole="button"
            style={[
                styles.smallButton,
                props.intent === 'danger' && styles.smallButtonDanger,
                props.disabled === true && styles.smallButtonDisabled,
            ]}
            disabled={props.disabled}
            onPress={props.onPress}
        >
            <Text style={styles.smallButtonText}>{props.label}</Text>
        </Pressable>
    );
}

function LoadingBlock(): React.ReactElement {
    return (
        <Screen style={styles.center}>
            <ActivityIndicator size="large" color={palette.primary[500]} />
        </Screen>
    );
}

function ErrorBlock(props: {
    title: string;
    detail: string;
    onRetry: () => void;
}): React.ReactElement {
    return (
        <Screen style={styles.center}>
            <AppText variant="title">{props.title}</AppText>
            <AppText style={styles.feedback}>{props.detail}</AppText>
            <FormButtonSmall label="Retry" onPress={props.onRetry} />
            <Pressable
                onPress={(): void => router.back()}
                style={styles.smallButtonGhost}
            >
                <Text style={styles.smallButtonGhostText}>Back</Text>
            </Pressable>
        </Screen>
    );
}

function InvalidChat(): React.ReactElement {
    return (
        <Screen style={styles.center}>
            <AppText variant="title">Invalid chat</AppText>
            <Pressable
                onPress={(): void => router.replace('/(app)')}
                style={styles.smallButtonGhost}
            >
                <Text style={styles.smallButtonGhostText}>Back to chats</Text>
            </Pressable>
        </Screen>
    );
}

const styles = StyleSheet.create({
    screen: { gap: spacing.xs, paddingHorizontal: spacing.sm },
    center: { alignItems: 'center', justifyContent: 'center' },
    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    headerMeta: { flex: 1 },
    avatar: { width: 44, height: 44, borderRadius: 22 },
    avatarFallback: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: palette.primary[100],
        alignItems: 'center',
        justifyContent: 'center',
    },
    avatarFallbackText: {
        color: palette.primary[700],
        fontSize: 18,
        fontWeight: '700',
    },
    backButton: { paddingHorizontal: spacing.xxs, paddingVertical: spacing.xs },
    backText: { color: palette.primary[600], fontSize: 26, fontWeight: '700' },
    pillButton: {
        borderWidth: 1,
        borderColor: palette.primary[500],
        borderRadius: radii.sm,
        paddingHorizontal: spacing.sm,
        paddingVertical: 4,
    },
    pillText: { color: palette.primary[600], fontSize: 13, fontWeight: '600' },
    chatArea: { flex: 1 },
    list: { flex: 1 },
    listContent: { paddingHorizontal: spacing.xs, paddingBottom: spacing.xs },
    daySlot: {},
    emptyState: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.xxs,
        paddingHorizontal: spacing.lg,
    },
    emptyCaption: { textAlign: 'center' },
    sendError: { color: palette.semantic.danger, paddingBottom: spacing.xxs },
    // action sheet
    sheetBackdrop: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.4)',
        justifyContent: 'flex-end',
        paddingHorizontal: spacing.sm,
        paddingBottom: spacing.md,
    },
    sheetCard: {
        backgroundColor: palette.neutral[0],
        borderRadius: radii.md,
        overflow: 'hidden',
    },
    sheetButton: { padding: spacing.md },
    sheetActionText: {
        color: palette.primary[600],
        fontSize: 16,
        fontWeight: '600',
        textAlign: 'center',
    },
    sheetDeleteText: {
        color: palette.semantic.danger,
        fontSize: 16,
        fontWeight: '600',
        textAlign: 'center',
    },
    sheetCancelText: {
        color: palette.neutral[500],
        fontSize: 16,
        textAlign: 'center',
    },
    sheetDivider: {
        height: StyleSheet.hairlineWidth,
        backgroundColor: palette.neutral[100],
    },
    modalAvoid: { flex: 1, justifyContent: 'center' },
    smallButtonDisabled: { opacity: 0.4 },
    // modals
    modalBackdrop: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.4)',
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: spacing.lg,
    },
    modalCard: {
        width: '100%',
        backgroundColor: palette.neutral[0],
        borderRadius: radii.md,
        padding: spacing.md,
        gap: spacing.sm,
    },
    modalInput: {
        borderWidth: 1,
        borderColor: palette.neutral[300],
        borderRadius: radii.sm,
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xs,
        minHeight: 60,
        color: palette.neutral[900],
        backgroundColor: palette.neutral[50],
    },
    modalError: { color: palette.semantic.danger },
    modalActions: { flexDirection: 'row', gap: spacing.xs },
    // admin
    adminScreen: { gap: spacing.md, paddingHorizontal: spacing.lg },
    adminHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    section: { gap: spacing.xxs },
    sectionFlex: { flex: 1 },
    input: {
        borderWidth: 1,
        borderColor: palette.neutral[300],
        borderRadius: radii.sm,
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xs,
        color: palette.neutral[900],
        backgroundColor: palette.neutral[0],
    },
    smallButton: {
        alignSelf: 'flex-start',
        backgroundColor: palette.primary[500],
        borderRadius: radii.sm,
        paddingHorizontal: spacing.sm,
        paddingVertical: 6,
    },
    smallButtonDanger: { backgroundColor: palette.semantic.danger },
    smallButtonText: {
        color: palette.neutral[0],
        fontSize: 13,
        fontWeight: '600',
    },
    smallButtonGhost: {
        alignSelf: 'flex-start',
        borderWidth: 1,
        borderColor: palette.primary[500],
        borderRadius: radii.sm,
        paddingHorizontal: spacing.sm,
        paddingVertical: 6,
    },
    smallButtonGhostText: {
        color: palette.primary[600],
        fontSize: 13,
        fontWeight: '600',
    },
    feedback: { color: palette.neutral[500] },
    bannedRow: {
        paddingVertical: spacing.xxs,
        borderBottomWidth: 1,
        borderBottomColor: palette.neutral[100],
    },
});
