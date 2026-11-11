import { useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    Modal,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import {
    AppText,
    Screen,
    UserAvatar,
    palette,
    radii,
    spacing,
    typography,
} from '../../shared/components';
import { useDebouncedValue } from '../../shared/hooks/use-debounced-value';
import {
    isStaleSearchResponse,
    normalizeChatSearchQuery,
    openPrivateChat,
} from '../../features/chats';
import { searchUsers } from '../../features/users/users-service';
import type { UserSearchItemDto } from '../../core/api/dto/user.dto';
import { ApiError } from '../../core/api';
import { parseInviteInput } from '../../features/groups/invite-links-model';

/**
 * New private chat: search a username, tap a result, open the conversation.
 *
 * Search rules (docs/mobile-api/users.md): min 2 chars after stripping one
 * leading `@`, prefix match, at most 20 results. Stale responses are ignored
 * (bumped request id + effect cleanup), and the empty chat is NOT added to the
 * chat list — it appears there after the first message.
 */

const DEBOUNCE_MS = 300;

function describeSearchError(error: unknown): string {
    if (error instanceof ApiError) {
        if (error.statusCode === 429) {
            return 'Too many requests, try again later';
        }
        if (error.statusCode === 0) {
            return 'Network problem — could not reach the server.';
        }
        return error.message;
    }
    if (error instanceof Error) {
        return error.message;
    }
    return 'Could not search users.';
}

export default function NewChatScreen(): React.ReactElement {
    const queryClient = useQueryClient();
    const [query, setQuery] = useState('');
    const debounced = useDebouncedValue(query, DEBOUNCE_MS);
    const normalized = normalizeChatSearchQuery(debounced);
    const [results, setResults] = useState<UserSearchItemDto[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [openingId, setOpeningId] = useState<number | null>(null);
    const [openError, setOpenError] = useState<string | null>(null);
    const [joinOpen, setJoinOpen] = useState(false);
    const [joinText, setJoinText] = useState('');
    const [joinError, setJoinError] = useState<string | null>(null);
    const requestIdRef = useRef(0);

    useEffect((): (() => void) => {
        const requestId = requestIdRef.current + 1;
        requestIdRef.current = requestId;

        if (normalized === null) {
            setResults([]);
            setLoading(false);
            setError(null);
            return (): void => undefined;
        }

        let active = true;
        setLoading(true);
        setError(null);
        searchUsers(normalized)
            .then((items): void => {
                if (
                    !active ||
                    isStaleSearchResponse(requestId, requestIdRef.current)
                ) {
                    return;
                }
                setResults(items);
                setLoading(false);
            })
            .catch((failure: unknown): void => {
                if (
                    !active ||
                    isStaleSearchResponse(requestId, requestIdRef.current)
                ) {
                    return;
                }
                setResults([]);
                setLoading(false);
                setError(describeSearchError(failure));
            });

        return (): void => {
            active = false;
        };
    }, [normalized]);

    const openResult = async (item: UserSearchItemDto): Promise<void> => {
        if (openingId !== null) return;
        setOpeningId(item.id);
        setOpenError(null);
        try {
            await openPrivateChat(item.id, { replace: true, queryClient });
        } catch (failure) {
            setOpenError(
                failure instanceof Error
                    ? failure.message
                    : 'Could not start this chat.',
            );
        } finally {
            setOpeningId(null);
        }
    };

    const pasteJoin = async (): Promise<void> => {
        try {
            const text = await Clipboard.getStringAsync();
            setJoinText(text);
            setJoinError(
                parseInviteInput(text) === null
                    ? "That doesn't look like an invite link."
                    : null,
            );
        } catch {
            setJoinError('Could not read the clipboard.');
        }
    };

    const continueJoin = (): void => {
        const code = parseInviteInput(joinText);
        if (code === null) {
            setJoinError("That doesn't look like an invite link.");
            return;
        }
        setJoinOpen(false);
        setJoinText('');
        setJoinError(null);
        router.push({ pathname: '/join/[code]', params: { code } });
    };

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
                <AppText variant="title" style={styles.headerTitle}>
                    New chat
                </AppText>
                <View style={styles.backButton} />
            </View>

            <Pressable
                accessibilityRole="button"
                accessibilityLabel="Join a group with a link"
                onPress={(): void => {
                    setJoinError(null);
                    setJoinOpen(true);
                }}
                style={({ pressed }) => [
                    styles.joinRow,
                    pressed && styles.rowPressed,
                ]}
            >
                <View style={styles.joinRowBody}>
                    <Text style={styles.joinRowTitle}>
                        Join a group with a link
                    </Text>
                    <Text style={styles.joinRowHint}>
                        Paste an invite link or code
                    </Text>
                </View>
                <Text style={styles.joinRowChevron}>›</Text>
            </Pressable>

            <TextInput
                style={styles.search}
                placeholder="Search by @username"
                placeholderTextColor={palette.neutral[300]}
                value={query}
                onChangeText={setQuery}
                autoFocus={true}
                autoCapitalize="none"
                autoCorrect={false}
                accessibilityLabel="Search users"
            />

            {error !== null ? (
                <View style={styles.center}>
                    <AppText variant="title">Search failed</AppText>
                    <AppText style={styles.detail}>{error}</AppText>
                </View>
            ) : loading ? (
                <View style={styles.center}>
                    <ActivityIndicator
                        size="large"
                        color={palette.primary[500]}
                    />
                </View>
            ) : normalized === null ? (
                <View style={styles.center}>
                    <AppText variant="caption">
                        Type at least 2 characters of a username.
                    </AppText>
                </View>
            ) : results.length === 0 ? (
                <View style={styles.center}>
                    <AppText variant="title">No users found</AppText>
                    <AppText style={styles.detail}>
                        Try a different username.
                    </AppText>
                </View>
            ) : (
                <FlatList
                    data={results}
                    keyExtractor={(item): string => String(item.id)}
                    keyboardShouldPersistTaps="handled"
                    contentContainerStyle={styles.list}
                    renderItem={({ item }): React.ReactElement => (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Message ${item.name}`}
                            accessibilityState={{
                                disabled: openingId !== null,
                            }}
                            disabled={openingId !== null}
                            onPress={(): void => {
                                void openResult(item);
                            }}
                            style={({ pressed }) => [
                                styles.row,
                                pressed && styles.rowPressed,
                            ]}
                        >
                            <UserAvatar
                                userId={item.id}
                                name={item.name}
                                uri={item.avatars[0] ?? null}
                                size={44}
                            />
                            <View style={styles.rowBody}>
                                <Text style={typography.body} numberOfLines={1}>
                                    {item.name}
                                </Text>
                                <Text
                                    style={typography.caption}
                                    numberOfLines={1}
                                >
                                    @{item.username}
                                </Text>
                            </View>
                            {openingId === item.id && (
                                <ActivityIndicator
                                    size="small"
                                    color={palette.primary[500]}
                                />
                            )}
                        </Pressable>
                    )}
                />
            )}

            {openError !== null && (
                <Text style={styles.error}>{openError}</Text>
            )}

            <Modal
                visible={joinOpen}
                transparent={true}
                animationType="slide"
                onRequestClose={(): void => setJoinOpen(false)}
            >
                <View style={styles.modalBackdrop}>
                    <View style={styles.modalSheet}>
                        <Text style={styles.modalTitle}>Join a group</Text>
                        <Text style={styles.modalHint}>
                            Paste the invite link or the 22-character code.
                        </Text>
                        <TextInput
                            style={styles.search}
                            placeholder="Invite link or code"
                            placeholderTextColor={palette.neutral[300]}
                            value={joinText}
                            onChangeText={(text): void => {
                                setJoinText(text);
                                setJoinError(null);
                            }}
                            autoCapitalize="none"
                            autoCorrect={false}
                            accessibilityLabel="Invite link or code"
                        />
                        {joinError !== null && (
                            <Text style={styles.error}>{joinError}</Text>
                        )}
                        <View style={styles.modalActions}>
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="Paste invite link"
                                onPress={(): void => {
                                    void pasteJoin();
                                }}
                                style={styles.ghostButton}
                            >
                                <Text style={styles.ghostButtonText}>
                                    Paste
                                </Text>
                            </Pressable>
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="Continue to join group"
                                onPress={continueJoin}
                                style={styles.primaryButton}
                            >
                                <Text style={styles.primaryButtonText}>
                                    Continue
                                </Text>
                            </Pressable>
                        </View>
                    </View>
                </View>
            </Modal>
        </Screen>
    );
}

const styles = StyleSheet.create({
    screen: { paddingHorizontal: spacing.md, gap: spacing.sm },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
    },
    backButton: {
        width: 40,
        height: 40,
        alignItems: 'center',
        justifyContent: 'center',
    },
    backText: { color: palette.primary[600], fontSize: 26, fontWeight: '700' },
    headerTitle: { flex: 1, textAlign: 'center' },
    search: {
        borderWidth: 1,
        borderColor: palette.neutral[300],
        borderRadius: radii.sm,
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xs,
        color: palette.neutral[900],
        backgroundColor: palette.neutral[0],
    },
    center: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.xxs,
    },
    detail: { textAlign: 'center', color: palette.neutral[500] },
    list: { paddingBottom: spacing.md },
    joinRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xs,
        borderRadius: radii.sm,
        backgroundColor: palette.primary[100],
    },
    joinRowBody: { flex: 1, gap: 2 },
    joinRowTitle: {
        color: palette.primary[700],
        fontSize: 14,
        fontWeight: '700',
    },
    joinRowHint: {
        color: palette.neutral[500],
        fontSize: 12,
    },
    joinRowChevron: {
        color: palette.primary[700],
        fontSize: 22,
    },
    modalBackdrop: {
        flex: 1,
        justifyContent: 'flex-end',
        backgroundColor: 'rgba(0,0,0,0.35)',
    },
    modalSheet: {
        backgroundColor: palette.neutral[0],
        borderTopLeftRadius: radii.md,
        borderTopRightRadius: radii.md,
        padding: spacing.md,
        paddingBottom: spacing.lg,
        gap: spacing.xs,
    },
    modalTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: palette.neutral[900],
    },
    modalHint: {
        color: palette.neutral[500],
        fontSize: 13,
    },
    modalActions: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        alignItems: 'center',
        gap: spacing.sm,
        marginTop: spacing.xs,
    },
    ghostButton: {
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.xs,
    },
    ghostButtonText: {
        color: palette.primary[700],
        fontSize: 14,
        fontWeight: '600',
    },
    primaryButton: {
        borderRadius: radii.sm,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.xs,
        backgroundColor: palette.primary[500],
    },
    primaryButtonText: {
        color: palette.neutral[0],
        fontSize: 14,
        fontWeight: '600',
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        paddingVertical: spacing.xs,
        borderRadius: radii.sm,
    },
    rowPressed: { backgroundColor: palette.neutral[50] },
    rowBody: { flex: 1, gap: 2 },
    error: { color: palette.semantic.danger, textAlign: 'center' },
});
