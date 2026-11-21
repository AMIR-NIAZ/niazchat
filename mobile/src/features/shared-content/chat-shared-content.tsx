import { useCallback, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    Pressable,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    useWindowDimensions,
    View,
} from 'react-native';
import type { ReactNode } from 'react';
import type { ListRenderItemInfo } from 'react-native';
import { FileText, ImageOff, Link2, Mic, Music2 } from 'lucide-react-native';
import { palette, radii, spacing } from '../../shared/theme';
import { AppText } from '../../shared/components';
import type {
    SharedAttachmentItemDto,
    SharedContentType,
    SharedLinkItemDto,
} from '../../core/api/dto/shared-content.dto';
import { openMediaViewer } from '../attachments/media-viewer-store';
import {
    buildSharedRows,
    MEDIA_GRID_COLUMNS,
    SHARED_TABS,
    tabDefinition,
    viewerMessageOf,
    type SharedContentRow,
    type SharedProfileTab,
} from './shared-content-model';
import { SharedContentTabs, type ProfileTabItem } from './shared-content-tabs';
import { MediaGridRow } from './media-grid-row';
import { SharedVoiceRow } from './shared-voice-row';
import { SharedMusicRow, musicTrackOf } from './shared-music-row';
import { SharedLinkRow } from './shared-link-row';
import { SharedFileRow } from './shared-file-row';
import {
    useChatAttachmentMedia,
    useChatLinks,
    useSharedContentRealtime,
} from './use-chat-media';
import type { MusicTrack } from '../../shared/music-player';

/**
 * The chat profile's shared content.
 *
 * ONE scrolling FlatList owns the whole section:
 *   data[0]  the profile header passed by the screen (never re-implemented)
 *   data[1]  the tab bar, pinned with `stickyHeaderIndices`
 *   data[2+] month headers and the ACTIVE tab's rows
 *
 * That avoids nesting a VirtualizedList inside the profile's ScrollView, keeps
 * row virtualization/`getItemLayout`, and makes the tab bar stick under the
 * screen header exactly like Telegram.
 *
 * Tabs are lazy (a tab's query is enabled the first time it is opened), pages
 * are cached when switching, and only the active tab is refreshed by pull to
 * refresh.
 */

type ListRow =
    | { kind: 'profile'; key: 'profile' }
    | { kind: 'tabs'; key: 'tabs' }
    | { kind: 'state'; key: 'state' }
    | { kind: 'member'; key: string; node: ReactNode }
    | SharedContentRow;

/**
 * Optional group Members tab. The screen owns the member rows (and their
 * actions/permission checks); this section only hosts them in the same
 * virtualized list and tab bar as the shared-content tabs.
 */
export interface MembersTabConfig {
    rows: readonly { key: string; node: ReactNode }[];
    hasNextPage: boolean;
    isFetchingNextPage: boolean;
    isRefetching: boolean;
    onLoadMore: () => void;
    onRefresh: () => void;
}

const MONTH_ROW_HEIGHT = 40;
const LINK_ROW_HEIGHT = 84;
const STATE_ROW_HEIGHT = 220;

const EMPTY_ICONS: Record<SharedContentType, typeof ImageOff> = {
    media: ImageOff,
    voice: Mic,
    music: Music2,
    links: Link2,
    files: FileText,
};

export function ChatSharedContent({
    chatId,
    header,
    showSender = false,
    members,
}: {
    /** Null when the profile has no conversation yet: header only. */
    chatId: number | null;
    header: ReactNode;
    /** Group profiles show each row's sender; private chats do not. */
    showSender?: boolean;
    /** Group profiles only: the leading, default-selected Members tab. */
    members?: MembersTabConfig;
}): React.ReactElement {
    const id = chatId ?? 0;
    const listRef = useRef<FlatList<ListRow>>(null);
    const { width } = useWindowDimensions();
    const [listWidth, setListWidth] = useState(width);
    const gap = 4;
    const tileSize = Math.max(
        1,
        Math.floor(
            (listWidth - spacing.sm * 2 - gap * (MEDIA_GRID_COLUMNS - 1)) /
                MEDIA_GRID_COLUMNS,
        ),
    );

    const hasMembersTab = members !== undefined;
    const [activeTab, setActiveTab] = useState<SharedProfileTab>(
        hasMembersTab ? 'members' : 'media',
    );
    const [opened, setOpened] = useState<ReadonlySet<SharedContentType>>(
        () => new Set<SharedContentType>(hasMembersTab ? [] : ['media']),
    );
    const profileTabs = useMemo<ProfileTabItem[]>(() => {
        const contentTabs = SHARED_TABS.map((tab) => ({
            type: tab.type,
            label: tab.label,
        }));
        return hasMembersTab
            ? [{ type: 'members', label: 'Members' }, ...contentTabs]
            : contentTabs;
    }, [hasMembersTab]);
    const [headerHeight, setHeaderHeight] = useState(0);
    const [tabsHeight, setTabsHeight] = useState(0);

    // All five hooks are always called; `enabled` keeps them lazy.
    const mediaQuery = useChatAttachmentMedia(
        id,
        'media',
        chatId !== null && opened.has('media'),
    );
    const voiceQuery = useChatAttachmentMedia(
        id,
        'voice',
        chatId !== null && opened.has('voice'),
    );
    const musicQuery = useChatAttachmentMedia(
        id,
        'music',
        chatId !== null && opened.has('music'),
    );
    const filesQuery = useChatAttachmentMedia(
        id,
        'files',
        chatId !== null && opened.has('files'),
    );
    const linksQuery = useChatLinks(id, chatId !== null && opened.has('links'));

    useSharedContentRealtime(id, chatId !== null);

    const activeQuery =
        activeTab === 'members'
            ? null
            : activeTab === 'media'
              ? mediaQuery
              : activeTab === 'voice'
                ? voiceQuery
                : activeTab === 'music'
                  ? musicQuery
                  : activeTab === 'links'
                    ? linksQuery
                    : filesQuery;

    const activeItems = useMemo<
        Array<SharedAttachmentItemDto | SharedLinkItemDto>
    >(
        () =>
            activeQuery?.data?.pages.flatMap(
                (page): Array<SharedAttachmentItemDto | SharedLinkItemDto> =>
                    page.items,
            ) ?? [],
        [activeQuery?.data],
    );
    const contentRows = useMemo(
        () =>
            activeTab === 'members'
                ? []
                : buildSharedRows(activeTab, activeItems),
        [activeTab, activeItems],
    );

    const mediaItems = useMemo<SharedAttachmentItemDto[]>(
        () => mediaQuery.data?.pages.flatMap((page) => page.items) ?? [],
        [mediaQuery.data],
    );
    const musicItems = useMemo<SharedAttachmentItemDto[]>(
        () => musicQuery.data?.pages.flatMap((page) => page.items) ?? [],
        [musicQuery.data],
    );
    const musicQueue = useMemo<MusicTrack[]>(
        () => musicItems.map((item) => musicTrackOf(item, id)),
        [musicItems, id],
    );

    const data = useMemo<ListRow[]>(() => {
        const rows: ListRow[] = [
            { kind: 'profile', key: 'profile' },
            { kind: 'tabs', key: 'tabs' },
        ];
        if (activeTab === 'members') {
            for (const row of members?.rows ?? []) {
                rows.push({ kind: 'member', key: row.key, node: row.node });
            }
            return rows;
        }
        if (contentRows.length === 0) {
            rows.push({ kind: 'state', key: 'state' });
        } else {
            rows.push(...contentRows);
        }
        return rows;
    }, [activeTab, contentRows, members]);

    const rowHeight = useCallback(
        (row: ListRow): number => {
            if (row.kind === 'profile') return headerHeight;
            if (row.kind === 'tabs') return tabsHeight;
            if (row.kind === 'member') return 72;
            if (row.kind === 'state') return STATE_ROW_HEIGHT;
            if (row.kind === 'month') return MONTH_ROW_HEIGHT;
            if (row.kind === 'media-row') return tileSize + 4;
            if (row.kind === 'link') return LINK_ROW_HEIGHT;
            const kind = row.item.attachment.kind;
            return kind === 'music' ? 100 : kind === 'voice' ? 78 : 74;
        },
        [headerHeight, tabsHeight, tileSize],
    );

    const getItemLayout = useCallback(
        (_data: ArrayLike<ListRow> | null | undefined, index: number) => {
            let offset = 0;
            for (let cursor = 0; cursor < index; cursor += 1) {
                offset += rowHeight(data[cursor]!);
            }
            return {
                length: rowHeight(data[index]!),
                offset,
                index,
            };
        },
        [data, rowHeight],
    );

    const changeTab = useCallback(
        (type: SharedProfileTab): void => {
            setActiveTab(type);
            if (type !== 'members') {
                setOpened((current) => {
                    if (current.has(type)) return current;
                    const next = new Set(current);
                    next.add(type);
                    return next;
                });
            }
            // Keep the sticky tab bar in place when switching (content changes).
            requestAnimationFrame((): void => {
                listRef.current?.scrollToOffset({
                    offset: headerHeight,
                    animated: false,
                });
            });
        },
        [headerHeight],
    );

    const openViewer = useCallback(
        (item: SharedAttachmentItemDto): void => {
            if (mediaItems.length === 0) return;
            openMediaViewer({
                messages: mediaItems.map(viewerMessageOf),
                initialMessageKey: `shared-${item.attachment.id}`,
                initialIndex: 0,
                origin: null,
            });
        },
        [mediaItems],
    );

    const renderItem = useCallback(
        ({ item: row }: ListRenderItemInfo<ListRow>): React.ReactElement => {
            if (row.kind === 'profile') {
                return (
                    <View
                        onLayout={(event): void =>
                            setHeaderHeight(event.nativeEvent.layout.height)
                        }
                    >
                        {header}
                    </View>
                );
            }
            if (row.kind === 'tabs') {
                return (
                    <View
                        onLayout={(event): void =>
                            setTabsHeight(event.nativeEvent.layout.height)
                        }
                    >
                        <SharedContentTabs
                            activeTab={activeTab}
                            tabs={profileTabs}
                            onChange={changeTab}
                        />
                    </View>
                );
            }
            if (row.kind === 'member') {
                return <View>{row.node}</View>;
            }
            if (row.kind === 'state') {
                if (activeQuery === null) return <View />;
                return (
                    <SharedContentState
                        type={activeTab === 'members' ? 'media' : activeTab}
                        loading={activeQuery.isPending}
                        error={
                            activeQuery.isError && activeItems.length === 0
                                ? 'Could not load this tab.'
                                : null
                        }
                        onRetry={(): void => {
                            void activeQuery.refetch();
                        }}
                    />
                );
            }
            if (row.kind === 'month') {
                return (
                    <View style={styles.monthRow}>
                        <Text style={styles.monthLabel}>{row.label}</Text>
                    </View>
                );
            }
            if (row.kind === 'media-row') {
                return (
                    <MediaGridRow
                        items={row.items}
                        tileSize={tileSize}
                        gap={gap}
                        onOpen={openViewer}
                    />
                );
            }
            if (row.kind === 'link') {
                return (
                    <SharedLinkRow item={row.item} showSender={showSender} />
                );
            }
            const item = row.item;
            if (item.attachment.kind === 'voice') {
                return <SharedVoiceRow item={item} showSender={showSender} />;
            }
            if (item.attachment.kind === 'music') {
                return (
                    <SharedMusicRow
                        item={item}
                        chatId={id}
                        queue={musicQueue}
                        showSender={showSender}
                    />
                );
            }
            return <SharedFileRow item={item} showSender={showSender} />;
        },
        [
            activeItems.length,
            activeQuery,
            activeTab,
            changeTab,
            gap,
            header,
            id,
            musicQueue,
            openViewer,
            profileTabs,
            showSender,
            tileSize,
        ],
    );

    const refresh = useCallback((): void => {
        if (activeTab === 'members') {
            members?.onRefresh();
            return;
        }
        void activeQuery?.refetch();
    }, [activeQuery, activeTab, members]);

    // A profile without a conversation has nothing to list yet.
    if (chatId === null) {
        return <ScrollView>{header}</ScrollView>;
    }

    return (
        <View
            style={styles.root}
            onLayout={(event): void => {
                const next = event.nativeEvent.layout.width;
                if (next > 0) setListWidth(next);
            }}
        >
            <FlatList
                ref={listRef}
                data={data}
                keyExtractor={(row): string => row.key}
                renderItem={renderItem}
                stickyHeaderIndices={[1]}
                getItemLayout={
                    activeTab === 'members' ? undefined : getItemLayout
                }
                contentContainerStyle={styles.content}
                refreshControl={
                    <RefreshControl
                        refreshing={
                            activeTab === 'members'
                                ? (members?.isRefetching ?? false)
                                : (activeQuery?.isRefetching ?? false) &&
                                  !(activeQuery?.isFetchingNextPage ?? false)
                        }
                        onRefresh={refresh}
                        tintColor={palette.primary[500]}
                    />
                }
                onEndReached={(): void => {
                    if (activeTab === 'members') {
                        if (
                            members?.hasNextPage === true &&
                            !members.isFetchingNextPage
                        ) {
                            members.onLoadMore();
                        }
                        return;
                    }
                    if (
                        activeQuery?.hasNextPage === true &&
                        !activeQuery.isFetchingNextPage
                    ) {
                        void activeQuery.fetchNextPage();
                    }
                }}
                onEndReachedThreshold={0.5}
                ListFooterComponent={
                    (
                        activeTab === 'members'
                            ? members?.isFetchingNextPage === true
                            : activeQuery?.isFetchingNextPage === true
                    ) ? (
                        <View style={styles.footer}>
                            <ActivityIndicator
                                size="small"
                                color={palette.primary[500]}
                            />
                        </View>
                    ) : (
                        <View style={styles.footerSpacer} />
                    )
                }
                initialNumToRender={8}
                maxToRenderPerBatch={10}
                windowSize={9}
                removeClippedSubviews={true}
                keyboardShouldPersistTaps="handled"
            />
        </View>
    );
}

function SharedContentState({
    type,
    loading,
    error,
    onRetry,
}: {
    type: SharedContentType;
    loading: boolean;
    error: string | null;
    onRetry: () => void;
}): React.ReactElement {
    const tab = tabDefinition(type);
    const Icon = EMPTY_ICONS[type];
    if (loading) {
        return (
            <View style={styles.state}>
                <ActivityIndicator size="small" color={palette.primary[500]} />
            </View>
        );
    }
    if (error !== null) {
        return (
            <View style={styles.state}>
                <AppText variant="caption" style={styles.stateText}>
                    {error}
                </AppText>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Retry loading this tab"
                    onPress={onRetry}
                    style={({ pressed }) => [
                        styles.retry,
                        pressed && styles.pressed,
                    ]}
                >
                    <Text style={styles.retryText}>Retry</Text>
                </Pressable>
            </View>
        );
    }
    return (
        <View style={styles.state}>
            <View style={styles.emptyIcon}>
                <Icon size={26} color={palette.text.muted} strokeWidth={1.7} />
            </View>
            <Text style={styles.stateTitle}>{tab.emptyTitle}</Text>
            <AppText variant="caption" style={styles.stateText}>
                {tab.emptyHint}
            </AppText>
        </View>
    );
}

/** The five tabs, exported for screens that render their own tab strip. */
export { SHARED_TABS };

const styles = StyleSheet.create({
    root: { flex: 1 },
    content: { paddingBottom: spacing.xl },
    monthRow: {
        height: MONTH_ROW_HEIGHT,
        justifyContent: 'center',
        paddingHorizontal: spacing.md,
        backgroundColor: palette.background,
    },
    monthLabel: {
        color: palette.text.secondary,
        fontSize: 12,
        fontWeight: '700',
        letterSpacing: 0.3,
    },
    state: {
        height: STATE_ROW_HEIGHT,
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.xs,
        paddingHorizontal: spacing.lg,
    },
    emptyIcon: {
        width: 56,
        height: 56,
        borderRadius: radii.full,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: palette.primary[100],
    },
    stateTitle: {
        color: palette.text.primary,
        fontSize: 15,
        fontWeight: '700',
        textAlign: 'center',
    },
    stateText: { textAlign: 'center', color: palette.text.secondary },
    retry: {
        marginTop: spacing.xxs,
        borderWidth: 1,
        borderColor: palette.primary[500],
        borderRadius: radii.sm,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.xxs,
    },
    pressed: { opacity: 0.6 },
    retryText: {
        color: palette.primary[600],
        fontSize: 13,
        fontWeight: '600',
    },
    footer: { paddingVertical: spacing.md, alignItems: 'center' },
    footerSpacer: { height: spacing.md },
});
