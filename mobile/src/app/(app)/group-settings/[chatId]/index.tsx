import { useCallback } from 'react';
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Pressable,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import type { ListRenderItemInfo } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import {
    AppText,
    palette,
    radii,
    spacing,
    typography,
} from '../../../../shared/components';
import { ApiError } from '../../../../core/api';
import { purgeChatFromCaches } from '../../../../features/chats';
import {
    canOpenGroupSettings,
    visibleGroupSettingsFeatures,
} from '../../../../features/groups/group-model';
import type { GroupSettingsFeature } from '../../../../features/groups/group-model';
import {
    useGroupChangedEvents,
    useGroupInfo,
    useGroupRemovedEvent,
    useGroupUpdatedEvents,
} from '../../../../features/groups/use-group';

/**
 * Group settings hub (`/group-settings/:chatId`).
 *
 * Reachable from the gear on a group header (owner/admin only). The list is
 * built from `GROUP_SETTINGS_FEATURES` and filtered by the caller's server
 * capabilities, so an admin without any capability sees the empty state and
 * can never open a screen the server would reject.
 */

type GroupSettingsRouteParams = { chatId?: string | string[] };

function parseChatId(value: string | string[] | undefined): number | null {
    const raw = Array.isArray(value) ? value[0] : value;
    if (raw === undefined) return null;
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export default function GroupSettingsScreen(): React.ReactElement {
    const params = useLocalSearchParams<GroupSettingsRouteParams>();
    const chatId = parseChatId(params.chatId);

    if (chatId === null) {
        return (
            <SettingsState
                title="Group settings"
                detail="This link is not valid."
            />
        );
    }
    return <GroupSettings chatId={chatId} />;
}

function GroupSettings({ chatId }: { chatId: number }): React.ReactElement {
    const queryClient = useQueryClient();
    const infoQuery = useGroupInfo(chatId);

    useGroupChangedEvents(chatId);
    useGroupUpdatedEvents();

    const handleRemoved = useCallback((): void => {
        purgeChatFromCaches(queryClient, chatId);
        Alert.alert('Removed from group', 'You were removed from this group');
        router.replace('/(app)');
    }, [queryClient, chatId]);
    useGroupRemovedEvent(chatId, handleRemoved);

    const info = infoQuery.data;

    if (infoQuery.isPending) {
        return (
            <View style={styles.root}>
                <TopBar />
                <View style={styles.centered}>
                    <ActivityIndicator
                        size="large"
                        color={palette.primary[500]}
                    />
                    <AppText variant="caption">Loading group settings…</AppText>
                </View>
            </View>
        );
    }

    if (infoQuery.isError || info === undefined) {
        const error = infoQuery.error;
        const privateChat =
            error instanceof ApiError && error.statusCode === 400;
        return (
            <View style={styles.root}>
                <TopBar />
                <SettingsState
                    title="Group settings unavailable"
                    detail={
                        privateChat
                            ? 'This screen is only available for groups.'
                            : error instanceof ApiError &&
                                error.statusCode === 403
                              ? "You don't have access to this group."
                              : 'Could not load this group.'
                    }
                    {...(privateChat
                        ? {}
                        : {
                              onRetry: (): void => {
                                  void infoQuery.refetch();
                              },
                          })}
                />
            </View>
        );
    }

    const features = visibleGroupSettingsFeatures(info.capabilities);
    const memberRole = canOpenGroupSettings(info.myRole);

    return (
        <View style={styles.root}>
            <TopBar />
            {!memberRole ? (
                <SettingsState
                    title="Group settings"
                    detail="You don't have access to group settings."
                />
            ) : features.length === 0 ? (
                <SettingsState
                    title="No settings available"
                    detail="You don't have access to any group settings. Ask the group owner."
                />
            ) : (
                <FlatList
                    data={features}
                    keyExtractor={(item): string => item.key}
                    contentContainerStyle={styles.list}
                    ListHeaderComponent={
                        <View style={styles.listHeader}>
                            <AppText variant="title" numberOfLines={2}>
                                {info.title || 'Unnamed group'}
                            </AppText>
                            <Text style={styles.caption}>
                                Choose what you want to change.
                            </Text>
                        </View>
                    }
                    renderItem={({
                        item,
                    }: ListRenderItemInfo<GroupSettingsFeature>) => (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`${item.title}. ${item.subtitle}`}
                            onPress={(): void =>
                                router.push(item.route(chatId))
                            }
                            style={({ pressed }) => [
                                styles.row,
                                pressed && styles.rowPressed,
                            ]}
                        >
                            <View style={styles.rowIcon}>
                                <Text style={styles.rowIconText}>
                                    {item.icon}
                                </Text>
                            </View>
                            <View style={styles.rowBody}>
                                <Text style={styles.rowTitle}>
                                    {item.title}
                                </Text>
                                <Text style={styles.rowSubtitle}>
                                    {item.subtitle}
                                </Text>
                            </View>
                            <Text style={styles.chevron}>›</Text>
                        </Pressable>
                    )}
                />
            )}
        </View>
    );
}

function TopBar(): React.ReactElement {
    return (
        <View style={styles.topBar}>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel="Go back"
                style={styles.backButton}
                onPress={(): void => router.back()}
            >
                <Text style={styles.backText}>‹</Text>
            </Pressable>
            <Text style={styles.topBarTitle} numberOfLines={1}>
                Group settings
            </Text>
            <View style={styles.topBarSpacer} />
        </View>
    );
}

function SettingsState(props: {
    title: string;
    detail: string;
    onRetry?: () => void;
}): React.ReactElement {
    return (
        <View style={styles.centered}>
            <AppText variant="title">{props.title}</AppText>
            <AppText variant="caption" style={styles.centeredCaption}>
                {props.detail}
            </AppText>
            {props.onRetry !== undefined && (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Retry loading group settings"
                    style={styles.retryButton}
                    onPress={props.onRetry}
                >
                    <Text style={styles.retryText}>Retry</Text>
                </Pressable>
            )}
            <Pressable
                accessibilityRole="button"
                accessibilityLabel="Go back"
                style={styles.backLink}
                onPress={(): void => router.back()}
            >
                <Text style={styles.backLinkText}>Go back</Text>
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: palette.background },
    topBar: {
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 52,
        paddingHorizontal: spacing.xs,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: palette.neutral[100],
        backgroundColor: palette.elevated,
    },
    backButton: {
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
    },
    backText: { fontSize: 32, lineHeight: 34, color: palette.neutral[900] },
    topBarTitle: {
        flex: 1,
        textAlign: 'center',
        fontSize: 16,
        fontWeight: '700',
        color: palette.neutral[900],
    },
    topBarSpacer: { width: 44 },
    list: { paddingVertical: spacing.md },
    listHeader: { paddingHorizontal: spacing.md, paddingBottom: spacing.md },
    caption: { ...typography.caption, marginTop: spacing.xxs },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        minHeight: 64,
        paddingHorizontal: spacing.md,
        backgroundColor: palette.elevated,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: palette.neutral[100],
    },
    rowPressed: { backgroundColor: palette.neutral[100] },
    rowIcon: {
        width: 36,
        height: 36,
        borderRadius: radii.full,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: palette.primary[100],
    },
    rowIconText: { fontSize: 18, color: palette.primary[700] },
    rowBody: { flex: 1, gap: 2 },
    rowTitle: { fontSize: 16, fontWeight: '600', color: palette.neutral[900] },
    rowSubtitle: typography.caption,
    chevron: { fontSize: 26, color: palette.neutral[300] },
    centered: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.xs,
        padding: spacing.lg,
    },
    centeredCaption: { textAlign: 'center' },
    retryButton: {
        marginTop: spacing.xs,
        borderRadius: radii.sm,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.xs,
        backgroundColor: palette.primary[500],
    },
    retryText: {
        color: palette.text.onAccent,
        fontSize: 14,
        fontWeight: '600',
    },
    backLink: { padding: spacing.sm },
    backLinkText: {
        fontSize: 14,
        fontWeight: '600',
        color: palette.primary[700],
    },
});
