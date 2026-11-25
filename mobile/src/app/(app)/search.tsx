import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    BackHandler,
    Keyboard,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';

import { useFocusEffect, router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Search, X } from 'lucide-react-native';
import {
    AppText,
    SafeText,
    Screen,
    UserAvatar,
    palette,
    radii,
    spacing,
    typography,
} from '../../shared/components';
import { useDebouncedValue } from '../../shared/hooks/use-debounced-value';
import { useReducedMotion } from '../../shared/hooks/use-reduced-motion';
import {
    CHATS_QUERY_KEY,
    chatPreviewText,
    filterChats,
    isStaleSearchResponse,
    normalizeChatSearchQuery,
    openPrivateChat,
} from '../../features/chats';
import type { ChatPreview, RecentSearchEntry } from '../../features/chats';
import {
    clearRecentSearches,
    loadRecentSearches,
    recentEntryKey,
    removeRecentSearch,
    saveRecentSearch,
} from '../../features/chats/search-recent';
import { useCurrentUserId } from '../../features/auth';
import { getMembership } from '../../features/groups/use-group-membership';
import { toast } from '../../shared/dialog';
import { searchUsers } from '../../features/users/users-service';
import { ApiError } from '../../core/api';
import { useTheme, useThemedStyles } from '../../shared/theme';
import type { AppTheme } from '../../shared/theme';

/**
 * Global search screen ("Chats" + "People") opened from the chat-list header.
 *
 * - Empty query → the per-user Recent list (AsyncStorage).
 * - Non-empty  → "Chats" (instant local filter over the cached chat list,
 *   works offline) + "People" (server `GET /user/search`, min 2 chars, stale
 *   responses discarded).
 * - Opening a chat or starting a private chat records a Recent entry.
 */

const DEBOUNCE_MS = 250;
/** Enter animation is limited to the first rows so long lists stay snappy. */
const ANIMATED_ROWS = 15;

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

export default function SearchScreen(): React.ReactElement {
    const theme = useTheme();
    const styles = useThemedStyles(createStyles);
    const queryClient = useQueryClient();
    const insets = useSafeAreaInsets();
    const reduceMotion = useReducedMotion();
    const currentUserId = useCurrentUserId();

    const [query, setQuery] = useState('');
    const debounced = useDebouncedValue(query, DEBOUNCE_MS);
    const normalizedQuery = debounced.trim().toLowerCase();
    const [keyboardOpen, setKeyboardOpen] = useState(false);

    // Recent (persisted per user) ------------------------------------------------
    const [recent, setRecent] = useState<RecentSearchEntry[]>([]);
    const reloadRecent = useCallback((): void => {
        if (currentUserId === null) {
            setRecent([]);
            return;
        }
        void loadRecentSearches(currentUserId).then(setRecent);
    }, [currentUserId]);
    // Reload when the screen gains focus (entries may have been added elsewhere).
    useFocusEffect(reloadRecent);

    // People (server) -------------------------------------------------------------
    const normalizedPeopleQuery = normalizeChatSearchQuery(debounced);
    const [people, setPeople] = useState<UserSearchItem[]>([]);
    const [peopleLoading, setPeopleLoading] = useState(false);
    const [peopleError, setPeopleError] = useState<string | null>(null);
    const [retryTick, setRetryTick] = useState(0);
    const requestIdRef = useRef(0);

    useEffect((): (() => void) => {
        const requestId = requestIdRef.current + 1;
        requestIdRef.current = requestId;

        if (normalizedPeopleQuery === null) {
            setPeople([]);
            setPeopleLoading(false);
            setPeopleError(null);
            return (): void => undefined;
        }

        let active = true;
        setPeopleLoading(true);
        setPeopleError(null);
        searchUsers(normalizedPeopleQuery)
            .then((items): void => {
                if (
                    !active ||
                    isStaleSearchResponse(requestId, requestIdRef.current)
                ) {
                    return;
                }
                setPeople(items);
                setPeopleLoading(false);
            })
            .catch((failure: unknown): void => {
                if (
                    !active ||
                    isStaleSearchResponse(requestId, requestIdRef.current)
                ) {
                    return;
                }
                setPeople([]);
                setPeopleLoading(false);
                setPeopleError(describeSearchError(failure));
            });

        return (): void => {
            active = false;
        };
    }, [normalizedPeopleQuery, retryTick]);

    // Local chat filter (instant, works offline) ----------------------------------
    const chats = queryClient.getQueryData<ChatPreview[]>(CHATS_QUERY_KEY);
    const chatResults = useMemo(
        () => filterChats(chats ?? [], normalizedQuery),
        [chats, normalizedQuery],
    );

    // Android hardware back closes the keyboard first, then the screen.
    useEffect((): (() => void) => {
        const show = Keyboard.addListener('keyboardDidShow', (): void => {
            setKeyboardOpen(true);
        });
        const hide = Keyboard.addListener('keyboardDidHide', (): void => {
            setKeyboardOpen(false);
        });
        const back = BackHandler.addEventListener('hardwareBackPress', (): boolean => {
            if (keyboardOpen) {
                Keyboard.dismiss();
                return true;
            }
            return false;
        });
        return (): void => {
            show.remove();
            hide.remove();
            back.remove();
        };
    }, [keyboardOpen]);

    const recordRecent = useCallback(
        (entry: RecentSearchEntry): void => {
            if (currentUserId === null) {
                return;
            }
            void saveRecentSearch(currentUserId, entry).then(reloadRecent);
        },
        [currentUserId, reloadRecent],
    );

    const removeRecent = useCallback(
        (entry: RecentSearchEntry): void => {
            if (currentUserId === null) {
                return;
            }
            // Optimistic: the row disappears immediately.
            setRecent((current): RecentSearchEntry[] =>
                current.filter((item) => recentEntryKey(item) !== recentEntryKey(entry)),
            );
            void removeRecentSearch(currentUserId, entry).then(reloadRecent);
        },
        [currentUserId, reloadRecent],
    );

    const openChatResult = useCallback(
        (chat: ChatPreview): void => {
            const chatId = Number(chat.id);
            // Groups I belong to open the conversation directly; the cached
            // chat list is the source of truth, a server `isMember`/`myRole`
            // on the row wins when present.
            const membership = getMembership(chatId, queryClient, {
                isMember: chat.isMember,
                myRole: chat.myRole,
            });
            if (membership === 'banned') {
                toast.show("You can't join this group");
                return;
            }
            if (membership === 'not-member') {
                toast.show("You're not a member of this group");
                void queryClient.invalidateQueries({
                    queryKey: CHATS_QUERY_KEY,
                });
                return;
            }
            recordRecent({
                kind: 'chat',
                chatId,
                name: displayTitle(chat),
                avatar: displayAvatar(chat),
            });
            router.push({
                pathname: '/(app)/chat/[chatId]',
                params: { chatId: String(chat.id) },
            });
        },
        [queryClient, recordRecent],
    );

    const [openingUserId, setOpeningUserId] = useState<number | null>(null);
    const openPerson = useCallback(
        async (userId: number, entry: RecentSearchEntry): Promise<void> => {
            if (openingUserId !== null) {
                return;
            }
            setOpeningUserId(userId);
            try {
                await openPrivateChat(userId, { queryClient });
                recordRecent(entry);
            } catch {
                // openPrivateChat throws a user-safe message; the row spinner
                // stops and the user can retry the tap.
            } finally {
                setOpeningUserId(null);
            }
        },
        [openingUserId, queryClient, recordRecent],
    );

    const peopleVisible = people.filter(
        (item) => Number(item.id) !== Number(currentUserId),
    );

    const showRecent = normalizedQuery === '';
    const rowEnteringProps = (index: number): { entering?: FadeInDown } => {
        if (reduceMotion || index >= ANIMATED_ROWS) return {};
        return { entering: FadeInDown.duration(160).delay(index * 16) };
    };

    return (
        <Screen withTopInset={false} style={styles.screen}>
        <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.screen}
        >
            <View
                style={[
                    styles.topBar,
                    {
                        paddingTop: insets.top + spacing.xs,
                        paddingBottom: spacing.sm,
                        paddingHorizontal: spacing.sm,
                    },
                ]}
            >
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Go back"
                    style={styles.backButton}
                    onPress={(): void => router.back()}
                >
                    <AppText style={styles.backText}>‹</AppText>
                </Pressable>
                <View style={styles.field}>
                    <Search
                        size={18}
                        color={theme.colors.textMuted}
                        strokeWidth={2}
                    />
                    <TextInput
                        style={styles.input}
                        placeholder="Search chats and people"
                        placeholderTextColor={theme.colors.textMuted}
                        selectionColor={theme.accent}
                        value={query}
                        onChangeText={setQuery}
                        autoFocus={true}
                        autoCapitalize="none"
                        autoCorrect={false}
                        accessibilityLabel="Search chats and people"
                    />
                    {query !== '' && (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Clear search"
                            hitSlop={6}
                            onPress={(): void => setQuery('')}
                        >
                            <X
                                size={18}
                                color={theme.colors.textSecondary}
                                strokeWidth={2}
                            />
                        </Pressable>
                    )}
                </View>
            </View>

            <ScrollView
                style={styles.results}
                contentContainerStyle={[
                    styles.resultsContent,
                    {
                        paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.md,
                    },
                ]}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                onScrollBeginDrag={(): void => Keyboard.dismiss()}
            >
                {showRecent ? (
                    <Section
                        title="Recent"
                        action={
                            recent.length > 0
                                ? {
                                      label: 'Clear',
                                      onPress: (): void => {
                                          if (currentUserId === null) {
                                              return;
                                          }
                                          setRecent([]);
                                          void clearRecentSearches(
                                              currentUserId,
                                          ).then(reloadRecent);
                                      },
                                  }
                                : undefined
                        }
                    >
                        {recent.map((entry, index) => (
                            <Animated.View
                                key={recentEntryKey(entry)}
                                {...rowEnteringProps(index)}
                            >
                                <RecentRow
                                    entry={entry}
                                    onRemove={(): void => removeRecent(entry)}
                                    onPress={(): void => {
                                        if (entry.kind === 'chat') {
                                            router.push({
                                                pathname: '/(app)/chat/[chatId]',
                                                params: {
                                                    chatId: String(entry.chatId),
                                                },
                                            });
                                            return;
                                        }
                                        void openPerson(entry.userId, entry);
                                    }}
                                    opening={entry.kind === 'user' && openingUserId === entry.userId}
                                />
                            </Animated.View>
                        ))}
                        {recent.length === 0 && (
                            <AppText variant="caption" style={styles.hint}>
                                Chats and people you open will show up here.
                            </AppText>
                        )}
                    </Section>
                ) : (
                    <>
                        <Section title="Chats">
                            {chatResults.map((chat, index) => (
                                <Animated.View
                                    key={`chat-${chat.id}`}
                                    {...rowEnteringProps(index)}
                                >
                                    <ChatResultRow
                                        chat={chat}
                                        currentUserId={currentUserId}
                                        onPress={(): void => openChatResult(chat)}
                                    />
                                </Animated.View>
                            ))}
                            {chatResults.length === 0 && (
                                <AppText variant="caption" style={styles.hint}>
                                    No matching chats.
                                </AppText>
                            )}
                        </Section>
                        <Section title="People">
                            {peopleLoading ? (
                                <SkeletonRows />
                            ) : peopleError !== null ? (
                                <View style={styles.errorRow}>
                                    <AppText style={styles.errorText}>
                                        {peopleError}
                                    </AppText>
                                    <Pressable
                                        accessibilityRole="button"
                                        accessibilityLabel="Retry the search"
                                        onPress={(): void => {
                                            setRetryTick((tick) => tick + 1);
                                        }}
                                        style={styles.retryButton}
                                    >
                                        <AppText style={styles.retryText}>
                                            Retry
                                        </AppText>
                                    </Pressable>
                                </View>
                            ) : normalizedPeopleQuery === null ? (
                                <AppText variant="caption" style={styles.hint}>
                                    Type at least 2 characters of a username.
                                </AppText>
                            ) : peopleVisible.length === 0 ? (
                                <AppText variant="caption" style={styles.hint}>
                                    No people found.
                                </AppText>
                            ) : (
                                peopleVisible.map((item, index) => (
                                    <Animated.View
                                        key={`user-${item.id}`}
                                        {...rowEnteringProps(index)}
                                    >
                                        <PersonRow
                                            item={item}
                                            opening={openingUserId === item.id}
                                            onPress={(): void => {
                                                void openPerson(item.id, {
                                                    kind: 'user',
                                                    userId: item.id,
                                                    name: item.name,
                                                    username: item.username,
                                                    avatar: item.avatars[0] ?? null,
                                                });
                                            }}
                                            onLongPress={(): void => {
                                                router.push({
                                                    pathname:
                                                        '/(app)/user/[userId]',
                                                    params: {
                                                        userId: String(item.id),
                                                        name: item.name,
                                                    },
                                                });
                                            }}
                                        />
                                    </Animated.View>
                                ))
                            )}
                        </Section>
                        {chatResults.length === 0 &&
                            !peopleLoading &&
                            peopleError === null &&
                            normalizedPeopleQuery !== null &&
                            peopleVisible.length === 0 && (
                                <AppText variant="title" style={styles.noResults}>
                                    No results for “{debounced.trim()}”
                                </AppText>
                            )}
                    </>
                )}
            </ScrollView>
        </KeyboardAvoidingView>
        </Screen>
    );
}

type UserSearchItem = import('../../core/api/dto/user.dto').UserSearchItemDto;

function displayTitle(chat: ChatPreview): string {
    const peerName = chat.peer?.name?.trim();
    if (peerName !== undefined && peerName !== '') {
        return peerName;
    }
    return chat.title?.trim() || 'Unnamed group';
}

function displayAvatar(chat: ChatPreview): string | null {
    return chat.peer?.avatars?.[0] ?? chat.avatarUrls?.[0] ?? null;
}

function Section(props: {
    title: string;
    action?: { label: string; onPress: () => void } | undefined;
    children: React.ReactNode;
}): React.ReactElement {
    const styles = useThemedStyles(createStyles);
    return (
        <View style={styles.section}>
            <View style={styles.sectionHead}>
                <AppText variant="label" style={styles.sectionTitle}>
                    {props.title}
                </AppText>
                {props.action !== undefined && (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Clear ${props.title.toLowerCase()}`}
                        hitSlop={6}
                        onPress={props.action.onPress}
                    >
                        <AppText style={styles.sectionAction}>
                            {props.action.label}
                        </AppText>
                    </Pressable>
                )}
            </View>
            {props.children}
        </View>
    );
}

/** Row shell shared by every result kind. */
function ResultRow(props: {
    accessibilityLabel: string;
    onLongPress?: (() => void) | undefined;
    onPress: () => void;
    children: React.ReactNode;
    trailing?: React.ReactNode;
}): React.ReactElement {
    const styles = useThemedStyles(createStyles);
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={props.accessibilityLabel}
            onLongPress={props.onLongPress}
            onPress={props.onPress}
            style={({ pressed }) =>
                pressed ? [styles.row, styles.rowPressed] : styles.row
            }
        >
            {props.children}
            <View style={styles.rowTrailing}>{props.trailing}</View>
        </Pressable>
    );
}

function RecentRow(props: {
    entry: RecentSearchEntry;
    onPress: () => void;
    onRemove: () => void;
    opening: boolean;
}): React.ReactElement {
    const theme = useTheme();
    const styles = useThemedStyles(createStyles);
    const { entry } = props;
    return (
        <ResultRow
            accessibilityLabel={
                entry.kind === 'chat'
                    ? `Open chat with ${entry.name}`
                    : `Message ${entry.name}`
            }
            onPress={props.onPress}
            trailing={
                <>
                    {props.opening && (
                        <ActivityIndicator
                            size="small"
                            color={theme.accent}
                        />
                    )}
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Remove from recent"
                        hitSlop={8}
                        onPress={props.onRemove}
                    >
                        <X
                            size={16}
                            color={theme.colors.textMuted}
                            strokeWidth={2}
                        />
                    </Pressable>
                </>
            }
        >
            <UserAvatar
                userId={
                    entry.kind === 'chat' ? entry.chatId : entry.userId
                }
                name={entry.name}
                uri={entry.avatar}
                size={44}
            />
            <View style={styles.rowBody}>
                <SafeText style={theme.type.body} lines={1}>
                    {entry.name}
                </SafeText>
                {entry.kind === 'user' && (
                    <AppText style={theme.type.caption} numberOfLines={1}>
                        @{entry.username}
                    </AppText>
                )}
            </View>
        </ResultRow>
    );
}

function ChatResultRow(props: {
    chat: ChatPreview;
    currentUserId: number | null;
    onPress: () => void;
}): React.ReactElement {
    const theme = useTheme();
    const styles = useThemedStyles(createStyles);
    const { chat, currentUserId } = props;
    return (
        <ResultRow
            accessibilityLabel={`Open chat with ${displayTitle(chat)}`}
            onPress={props.onPress}
        >
            <UserAvatar
                userId={chat.peer?.id ?? Number(chat.id)}
                name={displayTitle(chat)}
                uri={displayAvatar(chat)}
                size={44}
            />
            <View style={styles.rowBody}>
                <SafeText style={theme.type.body} lines={1}>
                    {displayTitle(chat)}
                </SafeText>
                <AppText style={theme.type.caption} numberOfLines={1}>
                    {chatPreviewText(chat.lastMessage, currentUserId)}
                </AppText>
            </View>
        </ResultRow>
    );
}

function PersonRow(props: {
    item: UserSearchItem;
    opening: boolean;
    onPress: () => void;
    onLongPress: () => void;
}): React.ReactElement {
    const theme = useTheme();
    const styles = useThemedStyles(createStyles);
    return (
        <ResultRow
            accessibilityLabel={`Message ${props.item.name}`}
            onLongPress={props.onLongPress}
            onPress={props.onPress}
            trailing={
                props.opening ? (
                    <ActivityIndicator
                        size="small"
                        color={theme.accent}
                    />
                ) : undefined
            }
        >
            <UserAvatar
                userId={props.item.id}
                name={props.item.name}
                uri={props.item.avatars[0] ?? null}
                size={44}
            />
            <View style={styles.rowBody}>
                <SafeText style={theme.type.body} lines={1}>
                    {props.item.name}
                </SafeText>
                <AppText style={theme.type.caption} numberOfLines={1}>
                    @{props.item.username}
                </AppText>
            </View>
        </ResultRow>
    );
}

/** Loading placeholder rows for the server "People" search. */
function SkeletonRows(): React.ReactElement {
    const theme = useTheme();
    const styles = useThemedStyles(createStyles);
    return (
        <>
            {[0, 1, 2].map((index) => (
                <View key={`skeleton-${index}`} style={styles.row}>
                    <View style={[styles.skeletonAvatar]} />
                    <View style={styles.rowBody}>
                        <View style={styles.skeletonLine} />
                        <View
                            style={[
                                styles.skeletonLine,
                                styles.skeletonLineShort,
                            ]}
                        />
                    </View>
                </View>
            ))}
        </>
    );
}

const createStyles = (theme: AppTheme) =>
    StyleSheet.create({
    screen: {
        flex: 1,
        backgroundColor: 'transparent',
    },
    topBar: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
        backgroundColor: theme.colors.glassHeader,
    },
    backButton: {
        width: 40,
        height: 40,
        alignItems: 'center',
        justifyContent: 'center',
    },
    backText: {
        color: theme.accent,
        fontSize: 26,
        fontWeight: '700',
    },
    field: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        minHeight: 40,
        borderRadius: radii.full,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.glassElevated,
        paddingHorizontal: spacing.sm,
    },
    input: {
        flex: 1,
        ...theme.type.body,
        color: theme.colors.text,
        paddingVertical: spacing.xs,
    },
    results: { flex: 1 },
    resultsContent: { paddingHorizontal: spacing.md },
    section: { gap: spacing.xxs, marginTop: spacing.sm },
    sectionHead: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: spacing.xxs,
    },
    sectionTitle: { color: theme.colors.textSecondary },
    sectionAction: {
        color: theme.accent,
        fontSize: 13,
        fontWeight: '600',
    },
    hint: { color: theme.colors.textMuted, paddingVertical: spacing.xs },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        paddingVertical: spacing.xs,
        paddingHorizontal: spacing.xxs,
        borderRadius: radii.sm,
    },
    rowPressed: { backgroundColor: theme.colors.accentSoft },
    rowBody: { flex: 1, minWidth: 0, gap: 2 },
    rowTrailing: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
    },
    skeletonAvatar: {
        width: 44,
        height: 44,
        borderRadius: radii.full / 2,
        backgroundColor: theme.colors.accentSoft,
    },
    skeletonLine: {
        height: 10,
        borderRadius: radii.full / 2,
        backgroundColor: theme.colors.accentSoft,
        width: 140,
    },
    skeletonLineShort: { width: 90 },
    errorRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        paddingVertical: spacing.xs,
    },
    errorText: {
        flex: 1,
        ...theme.type.caption,
        color: theme.colors.danger,
    },
    retryButton: {
        borderWidth: 1,
        borderColor: theme.colors.borderStrong,
        borderRadius: radii.full,
        paddingHorizontal: spacing.sm,
        paddingVertical: 4,
        backgroundColor: theme.colors.glassElevated,
    },
    retryText: {
        color: theme.accent,
        fontSize: 13,
        fontWeight: '600',
    },
    noResults: {
        textAlign: 'center',
        marginTop: spacing.xl,
        color: theme.colors.textSecondary,
    },
});
