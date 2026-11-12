import { useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { palette, radii, spacing, typography } from '../../shared/theme';
import { UserAvatar } from '../../shared/components';
import { useDebouncedValue } from '../../shared/hooks/use-debounced-value';
import { getChatDisplay, isPrivateChat } from '../chats/chats-model';
import { useChats } from '../chats/use-chats';
import type { ChatPreview } from '../chats/chats-model';
import { ApiError } from '../../core/api';
import type { ForwardMessagesResultDto } from '../../core/api/dto/message.dto';
import {
    MAX_FORWARD_TARGETS,
    chatForwardLabel,
    failedTargetIds,
    filterForwardChats,
    forwardRequestId,
    mergeForwardResults,
    successfulTargetCount,
    toggleTarget,
} from './forward-helpers';
import { forwardChatMessages } from './messages-socket-api';

interface ForwardPickerProps {
    visible: boolean;
    sourceChatId: number;
    messageIds: number[];
    onClose: () => void;
    onFinished: (successCount: number, targetChatIds: number[]) => void;
}

export function ForwardPicker({
    visible,
    sourceChatId,
    messageIds,
    onClose,
    onFinished,
}: ForwardPickerProps): React.ReactElement {
    const insets = useSafeAreaInsets();
    const chats = useChats();
    const [query, setQuery] = useState('');
    const debouncedQuery = useDebouncedValue(query, 200);
    const [selected, setSelected] = useState<Set<number>>(new Set());
    const [results, setResults] = useState<ForwardMessagesResultDto | null>(
        null,
    );
    const [error, setError] = useState<string | null>(null);
    const [sending, setSending] = useState(false);
    const sendingRef = useRef(false);
    const attemptRef = useRef<{
        key: string;
        requestId: string;
        targets: number[];
    } | null>(null);

    useEffect((): void => {
        if (visible) {
            setQuery('');
            setSelected(new Set());
            setResults(null);
            setError(null);
            attemptRef.current = null;
            if (chats.data === undefined) {
                void chats.refetch();
            }
        }
        // Reset only when the picker opens/changes source; chats.refetch is
        // stable enough for this effect.
    }, [visible, sourceChatId]);

    const eligibleChats = useMemo(
        () => (chats.data ?? []).filter((chat) => !chat.isBan),
        [chats.data],
    );
    const shownChats = useMemo(
        () => filterForwardChats(eligibleChats, debouncedQuery),
        [eligibleChats, debouncedQuery],
    );

    const selectedChats = useMemo(
        () => eligibleChats.filter((chat) => selected.has(chat.id)),
        [eligibleChats, selected],
    );

    const runForward = async (
        targetIds: number[],
        reuseRequestId: boolean,
    ): Promise<void> => {
        if (sendingRef.current || targetIds.length === 0) return;
        sendingRef.current = true;
        setSending(true);
        setError(null);

        const key = targetIds.join(',');
        const requestId =
            reuseRequestId &&
            attemptRef.current !== null &&
            attemptRef.current.key === key
                ? attemptRef.current.requestId
                : forwardRequestId();
        attemptRef.current = { key, requestId, targets: targetIds };

        try {
            const response = await forwardChatMessages({
                fromChatId: sourceChatId,
                messageIds,
                toChatIds: targetIds,
                requestId,
            });
            if (response === null) {
                throw new Error('No response from the server.');
            }
            const merged = mergeForwardResults(results, response);
            setResults(merged);

            const failures = failedTargetIds(merged);
            if (failures.length === 0) {
                onFinished(
                    successfulTargetCount(merged),
                    merged.results
                        .filter((row) => row.ok)
                        .map((row) => row.chatId),
                );
            }
        } catch (failure: unknown) {
            const isNetwork =
                failure instanceof ApiError && failure.statusCode === 0;
            if (isNetwork) {
                // Retrying a network failure must reuse the SAME requestId so
                // the server can return the stored result instead of duplicating.
                attemptRef.current = { key, requestId, targets: targetIds };
            } else {
                attemptRef.current = null;
            }
            setError(
                failure instanceof Error && failure.message.trim() !== ''
                    ? failure.message
                    : 'Could not forward these messages.',
            );
        } finally {
            sendingRef.current = false;
            setSending(false);
        }
    };

    const failed = results === null ? [] : failedTargetIds(results);
    const canSend = selected.size > 0 && messageIds.length > 0 && !sending;

    return (
        <Modal
            visible={visible}
            animationType="slide"
            presentationStyle="fullScreen"
            onRequestClose={(): void => {
                if (!sending) onClose();
            }}
        >
            <View
                style={[
                    styles.screen,
                    { paddingTop: insets.top, paddingBottom: insets.bottom },
                ]}
            >
                <View style={styles.header}>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Cancel forwarding"
                        disabled={sending}
                        onPress={onClose}
                        style={styles.headerButton}
                    >
                        <Text style={styles.cancel}>Cancel</Text>
                    </Pressable>
                    <Text style={styles.title}>Forward to…</Text>
                    <View style={styles.headerButton} />
                </View>

                <TextInput
                    value={query}
                    onChangeText={setQuery}
                    placeholder="Search chats"
                    placeholderTextColor={palette.neutral[500]}
                    style={styles.search}
                    accessibilityLabel="Search chats"
                />

                {selectedChats.length > 0 && (
                    <ScrollView
                        horizontal={true}
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.chips}
                    >
                        {selectedChats.map((chat) => (
                            <Pressable
                                key={chat.id}
                                accessibilityRole="button"
                                accessibilityLabel={`Remove ${chatForwardLabel(chat)}`}
                                onPress={(): void =>
                                    setSelected(
                                        (current) =>
                                            toggleTarget(current, chat.id)
                                                .selected,
                                    )
                                }
                                style={styles.chip}
                            >
                                <Text style={styles.chipText} numberOfLines={1}>
                                    {chatForwardLabel(chat)} ✕
                                </Text>
                            </Pressable>
                        ))}
                    </ScrollView>
                )}

                {chats.isLoading && chats.data === undefined ? (
                    <View style={styles.center}>
                        <ActivityIndicator color={palette.primary[500]} />
                    </View>
                ) : (
                    <FlatList
                        data={shownChats}
                        keyExtractor={(chat): string => String(chat.id)}
                        keyboardShouldPersistTaps="handled"
                        contentContainerStyle={styles.list}
                        ListEmptyComponent={
                            <Text style={styles.empty}>
                                {chats.error !== null
                                    ? 'Could not load your chats.'
                                    : 'No chats match this search.'}
                            </Text>
                        }
                        renderItem={({ item }): React.ReactElement => {
                            const isSelected = selected.has(item.id);
                            const display = getChatDisplay(item);
                            return (
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel={`Forward to ${chatForwardLabel(item)}`}
                                    accessibilityState={{
                                        selected: isSelected,
                                    }}
                                    style={({ pressed }) => [
                                        styles.row,
                                        pressed && styles.rowPressed,
                                    ]}
                                    onPress={(): void => {
                                        const next = toggleTarget(
                                            selected,
                                            item.id,
                                        );
                                        if (next.limitReached) {
                                            setError(
                                                `You can forward to up to ${MAX_FORWARD_TARGETS} chats at once.`,
                                            );
                                            return;
                                        }
                                        setError(null);
                                        setSelected(next.selected);
                                    }}
                                >
                                    <View
                                        style={[
                                            styles.check,
                                            isSelected && styles.checkOn,
                                        ]}
                                    >
                                        <Text style={styles.checkText}>
                                            {isSelected ? '✓' : ''}
                                        </Text>
                                    </View>
                                    <UserAvatar
                                        userId={display.userId ?? item.id}
                                        name={display.title}
                                        uri={display.avatarUri}
                                        size={36}
                                    />
                                    <View style={styles.rowBody}>
                                        <Text
                                            style={styles.rowTitle}
                                            numberOfLines={1}
                                        >
                                            {display.title}
                                        </Text>
                                        <Text
                                            style={styles.rowType}
                                            numberOfLines={1}
                                        >
                                            {isPrivateChat(item)
                                                ? 'Private chat'
                                                : 'Group chat'}
                                        </Text>
                                    </View>
                                </Pressable>
                            );
                        }}
                    />
                )}

                {error !== null && (
                    <View style={styles.errorBox}>
                        <Text style={styles.errorText}>{error}</Text>
                        {failed.length > 0 && (
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="Retry failed targets"
                                onPress={(): void => {
                                    void runForward(failed, false);
                                }}
                                style={styles.retry}
                            >
                                <Text style={styles.retryText}>
                                    Retry failed
                                </Text>
                            </Pressable>
                        )}
                    </View>
                )}

                {failed.length > 0 && error === null && (
                    <View style={styles.errorBox}>
                        <Text style={styles.errorTitle}>
                            Could not forward to:
                        </Text>
                        {results?.results
                            .filter((row) => !row.ok)
                            .map((row) => (
                                <Text key={row.chatId} style={styles.errorText}>
                                    {chatLabelById(eligibleChats, row.chatId)}:{' '}
                                    {row.message}
                                </Text>
                            ))}
                        {failed.length > 0 && (
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="Retry failed targets"
                                onPress={(): void => {
                                    void runForward(failed, false);
                                }}
                                style={styles.retry}
                            >
                                <Text style={styles.retryText}>
                                    Retry failed
                                </Text>
                            </Pressable>
                        )}
                    </View>
                )}

                <View style={styles.footer}>
                    <Text style={styles.summary}>
                        {messageIds.length} message
                        {messageIds.length === 1 ? '' : 's'} to {selected.size}{' '}
                        chat{selected.size === 1 ? '' : 's'}
                    </Text>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Send forwarded messages"
                        accessibilityState={{ disabled: !canSend }}
                        disabled={!canSend}
                        onPress={(): void => {
                            void runForward([...selected], true);
                        }}
                        style={[styles.send, !canSend && styles.sendDisabled]}
                    >
                        {sending ? (
                            <ActivityIndicator
                                size="small"
                                color={palette.text.onAccent}
                            />
                        ) : (
                            <Text style={styles.sendText}>Send</Text>
                        )}
                    </Pressable>
                </View>
            </View>
        </Modal>
    );
}

function chatLabelById(chats: ChatPreview[], chatId: number): string {
    const chat = chats.find((row) => row.id === chatId);
    return chat === undefined ? `Chat ${chatId}` : chatForwardLabel(chat);
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: palette.neutral[0] },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
    },
    headerButton: { minWidth: 64 },
    title: { ...typography.title, fontSize: 19 },
    cancel: { color: palette.primary[600], fontSize: 15, fontWeight: '600' },
    search: {
        marginHorizontal: spacing.md,
        borderWidth: 1,
        borderColor: palette.neutral[300],
        borderRadius: radii.lg,
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xs + 2,
        color: palette.neutral[900],
        backgroundColor: palette.neutral[50],
    },
    chips: { gap: spacing.xs, padding: spacing.sm },
    chip: {
        maxWidth: 180,
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xs,
        borderRadius: radii.full,
        backgroundColor: palette.primary[100],
    },
    chipText: {
        color: palette.primary[700],
        fontSize: 12,
        fontWeight: '600',
    },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    list: { paddingHorizontal: spacing.md, paddingBottom: spacing.md },
    empty: {
        color: palette.neutral[500],
        textAlign: 'center',
        paddingVertical: spacing.xl,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        paddingVertical: spacing.sm,
        borderBottomWidth: 1,
        borderBottomColor: palette.neutral[100],
    },
    rowPressed: { backgroundColor: palette.neutral[50] },
    check: {
        width: 26,
        height: 26,
        borderRadius: 13,
        borderWidth: 1.5,
        borderColor: palette.neutral[300],
        alignItems: 'center',
        justifyContent: 'center',
    },
    checkOn: {
        backgroundColor: palette.primary[500],
        borderColor: palette.primary[500],
    },
    checkText: {
        color: palette.text.onAccent,
        fontSize: 14,
        fontWeight: '700',
    },
    rowBody: { flex: 1 },
    rowTitle: { color: palette.neutral[900], fontSize: 15, fontWeight: '600' },
    rowType: { color: palette.neutral[500], fontSize: 12 },
    errorBox: {
        marginHorizontal: spacing.md,
        marginBottom: spacing.xs,
        padding: spacing.sm,
        borderRadius: radii.sm,
        backgroundColor: '#FDECEA',
        gap: 4,
    },
    errorTitle: {
        color: palette.semantic.danger,
        fontSize: 12,
        fontWeight: '700',
    },
    errorText: { color: palette.semantic.danger, fontSize: 12 },
    retry: { alignSelf: 'flex-start', paddingVertical: 4 },
    retryText: {
        color: palette.primary[700],
        fontSize: 12,
        fontWeight: '700',
    },
    footer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: spacing.sm,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        borderTopWidth: 1,
        borderTopColor: palette.neutral[100],
    },
    summary: { flex: 1, color: palette.neutral[700], fontSize: 13 },
    send: {
        minWidth: 86,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        borderRadius: radii.lg,
        backgroundColor: palette.primary[500],
        alignItems: 'center',
    },
    sendDisabled: { backgroundColor: palette.neutral[300] },
    sendText: {
        color: palette.text.onAccent,
        fontSize: 14,
        fontWeight: '700',
    },
});
