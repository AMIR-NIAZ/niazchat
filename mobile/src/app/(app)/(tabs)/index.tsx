import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentRef } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import {
    ActivityIndicator,
    FlatList,
    Pressable,
    RefreshControl,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import {
    AppText,
    GlassHeader,
    GlassSurface,
    OfflineCaption,
    Screen,
    radii,
    spacing,
} from '../../../shared/components';
import { EdgeFadeView, FADE_EXTRA } from '../../../shared/edge-fade';
import { useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FILL_ABSOLUTE, palette, shadows } from '../../../shared/theme';
import {
    measureInWindow,
    useContextPopup,
    usePopupHidden,
} from '../../../shared/context-popup';
import type { PopupRect } from '../../../shared/context-popup';
import { useHomeTabReselect, useTabBarInset } from '../../../shared/tab-bar';
import { dialog, toast } from '../../../shared/dialog';
import { ApiError } from '../../../core/api';
import {
    ChatRowContent,
    ChatRowPreview,
    chatPreviewText,
    getChatListActions,
    invalidateChats,
    myChatRoleQuery,
    isPrivateChat,
    purgeChatFromCaches,
    setChatUnreadCount,
    sortPinnedFirst,
    useChats,
    useLeaveGroup,
    usePinnedChatIds,
} from '../../../features/chats';
import type { ChatListActionId, ChatRole } from '../../../features/chats';
import { markChatSeen } from '../../../features/messages';
import { openUserProfile } from '../../../features/users';
import { useCurrentUserId } from '../../../features/auth';
import { Search } from 'lucide-react-native';
import {
    MUSIC_BAR_LIFT,
    useMiniPlayerAnchor,
    useMusicBarShown,
} from '../../../shared/music-player';
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withSpring,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

/**
 * Chats screen — renders the WS-provided chat list.
 *
 * The list runs edge to edge behind the floating header and the pill tab bar,
 * with a soft alpha fade at both edges (`EdgeFadeView`, same look as the
 * message list in the chat screen). The header only holds the title and one
 * search button that opens the dedicated search screen.
 *
 * Unread counts come from `getAllChats` (authoritative) and are incremented
 * locally by live `chatlist:updated` events; reading a chat resets them.
 */

type ChatRow = import('../../../features/chats').ChatPreview;

/** Created ONCE at module scope: creating it inside a component remounts the button on every render. */
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export default function ChatsScreen(): React.ReactElement {
    const chatsQuery = useChats();
    const queryClient = useQueryClient();
    const popup = useContextPopup();
    const currentUserId = useCurrentUserId();
    const { pinned, togglePin } = usePinnedChatIds(currentUserId);
    const leaveGroup = useLeaveGroup();
    const tabBarInset = useTabBarInset();
    const listRef = useRef<FlatList<ChatRow>>(null);
    const insets = useSafeAreaInsets();
    // Measured header layer (safe-area top + glass pill + optional offline
    // caption): the list clears exactly this space and the fade starts there.
    const [headerHeight, setHeaderHeight] = useState(0);

    // Re-pressing the active Home tab scrolls the list back to the top.
    useHomeTabReselect(
        useCallback((): void => {
            listRef.current?.scrollToOffset({ offset: 0, animated: true });
        }, []),
    );

    // Updates missed while this screen was unmounted: refetch on focus.
    useFocusEffect(
        useCallback((): void => {
            void invalidateChats(queryClient);
        }, [queryClient]),
    );

    const chats = chatsQuery.data ?? [];
    // Cached rows always render, even while a background refetch is failing.
    const hasCachedChats = chatsQuery.data !== undefined;
    const visible = useMemo(
        () => sortPinnedFirst(chats, pinned),
        [chats, pinned],
    );

    const measureHeader = useCallback((event: LayoutChangeEvent): void => {
        const height = event.nativeEvent.layout.height;
        if (height <= 0) {
            return;
        }
        setHeaderHeight((previous): number =>
            Math.abs(previous - height) < 0.5 ? previous : height,
        );
    }, []);

    // This screen owns the mini bar's top edge: while it is focused and its
    // header layer is measured, the bar sits directly under it.
    useMiniPlayerAnchor(headerHeight > 0 ? headerHeight : null);
    // The bar only takes list space while it is actually shown here; when it
    // is hidden the list does not know about it (one state flip per change).
    const musicBarShown = useMusicBarShown();
    const barLift = musicBarShown ? MUSIC_BAR_LIFT : 0;
    const scrollOffsetRef = useRef(0);
    const barLiftRef = useRef(0);

    // The list is NOT inverted: growing its top padding would pull the visible
    // rows down, so keep the scroll position when the user is not at the top.
    useEffect((): void => {
        const delta = barLift - barLiftRef.current;
        if (delta === 0) {
            return;
        }
        barLiftRef.current = barLift;
        if (scrollOffsetRef.current > 0) {
            listRef.current?.scrollToOffset({
                offset: scrollOffsetRef.current + delta,
                animated: false,
            });
        }
    }, [barLift]);

    /// Floating chat-list popup ------------------------------------------------

    const markChatRead = (chat: ChatRow): void => {
        if (chat.lastMessage === null) {
            return;
        }
        const chatId = Number(chat.id);
        const previous = chat.unreadCount;
        // Optimistic: the badge clears immediately, the ack is authoritative.
        setChatUnreadCount(queryClient, chatId, 0);
        void markChatSeen(chatId, chat.lastMessage.id).catch(
            (error: unknown) => {
                setChatUnreadCount(queryClient, chatId, previous);
                dialog.show({
                    title: 'Could not mark as read',
                    message:
                        error instanceof Error
                            ? error.message
                            : 'Try again in a moment.',
                    tone: 'danger',
                });
            },
        );
    };

    const confirmLeaveGroup = (chat: ChatRow): void => {
        const chatId = Number(chat.id);
        void dialog
            .confirm({
                title: 'Leave group?',
                message:
                    'You will be removed from this group and will no longer receive its messages. An admin will have to add you again.',
                confirmText: 'Leave',
                destructive: true,
            })
            .then((confirmed): void => {
                if (!confirmed) {
                    return;
                }
                void leaveGroup
                    .mutateAsync(chatId)
                    .then((): void => {
                        purgeChatFromCaches(queryClient, chatId);
                        toast.show('You are no longer a member of this group.');
                    })
                    .catch((error: unknown) => {
                        // 403/404: membership is already gone server side —
                        // drop local access the same way.
                        if (
                            error instanceof ApiError &&
                            (error.statusCode === 403 ||
                                error.statusCode === 404)
                        ) {
                            purgeChatFromCaches(queryClient, chatId);
                            toast.show(
                                'You are no longer a member of this group.',
                            );
                            return;
                        }
                        dialog.show({
                            title: 'Could not leave group',
                            message:
                                error instanceof Error
                                    ? error.message
                                    : 'Try again in a moment.',
                            tone: 'danger',
                        });
                    });
            });
    };

    const runChatAction = (chat: ChatRow, action: ChatListActionId): void => {
        const chatId = Number(chat.id);
        switch (action) {
            case 'pin':
            case 'unpin':
                togglePin(chatId);
                return;
            case 'mark-read':
                markChatRead(chat);
                return;
            case 'group-info':
                router.push(`/(app)/group/${chatId}`);
                return;
            case 'view-profile': {
                const peer = chat.peer;
                if (peer === null) return;
                openUserProfile({
                    userId: peer.id,
                    name: peer.name,
                    avatar: peer.avatars[0] ?? null,
                });
                return;
            }
            case 'leave-group':
                confirmLeaveGroup(chat);
                return;
        }
    };

    /** Warms the caller's role while the row is held, so the menu is instant. */
    const prefetchRole = (chat: ChatRow): void => {
        if (isPrivateChat(chat)) {
            return;
        }
        void queryClient.prefetchQuery(myChatRoleQuery(Number(chat.id)));
    };

    const openChatMenu = async (
        chat: ChatRow,
        anchor: PopupRect,
    ): Promise<void> => {
        const chatId = Number(chat.id);
        const isPinned = pinned.has(chatId);
        let role: ChatRole | null = null;
        if (!isPrivateChat(chat)) {
            // The owner cannot leave; the row is hidden without the role.
            role = await queryClient
                .ensureQueryData(myChatRoleQuery(chatId))
                .catch((): ChatRole | null => null);
        }
        const rows = getChatListActions(chat, {
            markSeenAvailable: true,
            pinned: isPinned,
            role,
        });
        // Nothing to offer (no action available): the long press does nothing.
        if (rows.length === 0) {
            return;
        }
        popup.open({
            anchor,
            align: 'start',
            sourceKey: `chat:${chat.id}`,
            actions: rows.map((action) => ({
                id: action.id,
                label: action.label,
                icon: action.icon,
                destructive: action.destructive,
                onPress: (): void => runChatAction(chat, action.id),
            })),
            preview: (
                <ChatRowPreview
                    chat={chat}
                    pinned={isPinned}
                    previewText={chatPreviewText(
                        chat.lastMessage,
                        currentUserId,
                    )}
                    width={anchor.width}
                />
            ),
            accessibilityLabel: 'Chat actions',
        });
    };

    // ── Full-screen list geometry ────────────────────────────────────────────
    // The header and the pill tab bar float over the list; the list only
    // clears them, and the edge fade runs exactly past their edges so the
    // first row (at rest) and the last row (scrolled to the end) are fully
    // visible while rows in motion dissolve under the chrome.
    const listPaddingTop = Math.round(headerHeight + spacing.xs + barLift);
    const listPaddingBottom = Math.round(tabBarInset + spacing.sm);
    const topFade = Math.round(headerHeight + FADE_EXTRA + barLift);
    const bottomFade = Math.round(tabBarInset + FADE_EXTRA);

    return (
        <Screen
            style={styles.screen}
            withTopInset={false}
            withBottomInset={false}
        >
            {hasCachedChats && visible.length > 0 ? (
                <EdgeFadeView
                    style={styles.listLayer}
                    topFade={topFade}
                    bottomFade={bottomFade}
                >
                    <FlatList
                        ref={listRef}
                        style={styles.list}
                        data={visible}
                        keyExtractor={(item: ChatRow): string =>
                            String(item.id)
                        }
                        refreshControl={
                            <RefreshControl
                                refreshing={chatsQuery.isRefetching}
                                // The spinner must clear the floating header.
                                progressViewOffset={headerHeight}
                                onRefresh={(): void => {
                                    void chatsQuery.refetch();
                                }}
                            />
                        }
                        renderItem={({ item }): React.ReactElement => (
                            <ChatRowItem
                                chat={item}
                                currentUserId={currentUserId}
                                pinned={pinned.has(Number(item.id))}
                                onHold={prefetchRole}
                                onLongPress={openChatMenu}
                            />
                        )}
                        ItemSeparatorComponent={RowSeparator}
                        contentContainerStyle={{
                            paddingTop: listPaddingTop,
                            paddingBottom: listPaddingBottom,
                        }}
                        onScroll={(event): void => {
                            scrollOffsetRef.current =
                                event.nativeEvent.contentOffset.y;
                        }}
                        scrollEventThrottle={16}
                        scrollIndicatorInsets={{
                            top: Math.round(headerHeight),
                            bottom: Math.round(tabBarInset),
                        }}
                    />
                </EdgeFadeView>
            ) : (
                <View
                    style={[
                        styles.center,
                        headerHeight > 0 && {
                            paddingTop: listPaddingTop + spacing.sm,
                        },
                    ]}
                >
                    {!hasCachedChats && chatsQuery.isPending ? (
                        <ActivityIndicator
                            size="large"
                            color={palette.primary[500]}
                        />
                    ) : !hasCachedChats && chatsQuery.isError ? (
                        <StateBlock
                            title="Could not load chats"
                            detail={chatsQuery.error.message}
                            retry={(): void => {
                                void chatsQuery.refetch();
                            }}
                        />
                    ) : (
                        <StateBlock
                            title="No chats yet"
                            detail='Start a private chat with "New chat" or create a group with "+ Group".'
                            retry={(): void => {
                                void chatsQuery.refetch();
                            }}
                        />
                    )}
                </View>
            )}

            <View
                pointerEvents="box-none"
                style={[
                    styles.headerLayer,
                    {
                        paddingTop: insets.top + spacing.md,
                        paddingHorizontal: spacing.sm,
                    },
                ]}
                onLayout={measureHeader}
            >
                <GlassHeader layout="row" trailing={<SearchIconButton />}>
                    <AppText variant="heading">Chats</AppText>
                </GlassHeader>
                <OfflineCaption />
            </View>

            <GlassSurface
                tone="accent"
                radius={radii.full}
                floating={true}
                style={[styles.fabWrap, { bottom: tabBarInset }]}
            >
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Create a group"
                    style={styles.fab}
                    onPress={(): void => {
                        router.push('/(app)/create-group');
                    }}
                >
                    <Text style={styles.fabText}>＋ Group</Text>
                </Pressable>
            </GlassSurface>
        </Screen>
    );
}

/** One search button in the header's trailing slot — no other header controls. */
function SearchIconButton(): React.ReactElement {
    const scale = useSharedValue(1);
    const animatedStyle = useAnimatedStyle(() => ({
        transform: [{ scale: scale.value }],
    }));
    return (
        <AnimatedPressable
            accessibilityRole="button"
            accessibilityLabel="Search"
            style={[styles.searchButton, shadows.glass, animatedStyle]}
            hitSlop={2}
            onPressIn={(): void => {
                scale.value = withSpring(0.92, { damping: 20, stiffness: 300 });
                try {
                    void Haptics.selectionAsync();
                } catch {
                    // Haptics are unavailable on some devices / simulators.
                }
            }}
            onPressOut={(): void => {
                scale.value = withSpring(1, { damping: 20, stiffness: 300 });
            }}
            onPress={(): void => {
                router.push('/(app)/search');
            }}
        >
            <Search size={20} color="rgba(255,255,255,0.92)" strokeWidth={2} />
        </AnimatedPressable>
    );
}

interface ChatRowItemProps {
    chat: ChatRow;
    /** Viewer id: a service preview addressed to them renders "You". */
    currentUserId: number | null;
    pinned: boolean;
    /** Runs while the row is held: warms whatever the menu needs. */
    onHold: (chat: ChatRow) => void;
    onLongPress: (chat: ChatRow, anchor: PopupRect) => void | Promise<void>;
}

const LONG_PRESS_MS = 350;

function ChatRowItem(props: ChatRowItemProps): React.ReactElement {
    const { chat, currentUserId, pinned } = props;
    const rowRef = useRef<ComponentRef<typeof View>>(null);
    // Releasing a hold that opened the menu must not also navigate.
    const pressStartedAtRef = useRef(0);
    const previewText = chatPreviewText(chat.lastMessage, currentUserId);
    // Hidden (opacity only, UI thread) while the popup draws this row's copy on
    // top of it. Applied to the row's own Pressable: no extra node, so the row
    // keeps its exact layout whether the popup is open or not.
    const hiddenStyle = usePopupHidden(`chat:${chat.id}`);

    return (
        <Pressable
            ref={rowRef}
            accessibilityRole="button"
            accessibilityHint="Tap to open, long press for chat actions"
            delayLongPress={LONG_PRESS_MS}
            // Reanimated styles are plain view styles at runtime; the cast is
            // only for Pressable's non-animated style type.
            style={hiddenStyle as StyleProp<ViewStyle>}
            onPressIn={(): void => {
                pressStartedAtRef.current = Date.now();
                props.onHold(chat);
            }}
            onLongPress={(): void => {
                void measureInWindow(rowRef).then((anchor): void => {
                    if (anchor === null) {
                        return;
                    }
                    void props.onLongPress(chat, anchor);
                });
            }}
            onPress={(): void => {
                if (Date.now() - pressStartedAtRef.current >= LONG_PRESS_MS) {
                    return;
                }
                router.push({
                    pathname: '/(app)/chat/[chatId]',
                    params: { chatId: String(chat.id) },
                });
            }}
        >
            <ChatRowContent
                chat={chat}
                pinned={pinned}
                previewText={previewText}
            />
        </Pressable>
    );
}

function RowSeparator(): React.ReactElement {
    return <View style={styles.separator} />;
}

function StateBlock(props: {
    title: string;
    detail: string;
    retry?: (() => void) | undefined;
}): React.ReactElement {
    return (
        <View style={styles.center}>
            <AppText variant="title">{props.title}</AppText>
            <AppText style={styles.stateDetail}>{props.detail}</AppText>
            {props.retry !== undefined && <RetryButton onPress={props.retry} />}
        </View>
    );
}

function RetryButton({ onPress }: { onPress: () => void }): React.ReactElement {
    return (
        <Pressable
            accessibilityRole="button"
            style={styles.buttonGhost}
            onPress={onPress}
        >
            <Text style={styles.buttonGhostText}>Retry</Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1 },
    headerLayer: {
        position: 'absolute',
        top: 0,
        start: 0,
        end: 0,
        gap: spacing.xxs,
    },
    searchButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(20,10,40,0.55)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.14)',
    },
    // Explicit fill: `StyleSheet.absoluteFillObject` is gone in RN 0.88 and
    // spreading it left this layer without any position or size.
    listLayer: FILL_ABSOLUTE,
    list: { flex: 1 },
    center: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.xs,
    },
    stateDetail: { textAlign: 'center', color: palette.neutral[500] },
    separator: { height: 1, backgroundColor: palette.border.subtle },
    fabWrap: {
        position: 'absolute',
        end: spacing.lg,
    },
    fab: {
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
    },
    fabText: {
        color: palette.text.onAccent,
        fontWeight: '700',
        fontSize: 14,
    },
    buttonGhost: {
        borderWidth: 1,
        borderColor: palette.border.strong,
        borderRadius: radii.full,
        paddingHorizontal: spacing.sm,
        paddingVertical: 6,
        backgroundColor: palette.glass.elevated,
    },
    buttonGhostText: {
        color: palette.primary[600],
        fontSize: 13,
        fontWeight: '600',
    },
});
