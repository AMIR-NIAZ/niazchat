import React, { useCallback, useEffect, useRef } from 'react';
import {
    ActivityIndicator,
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
    SafeText,
    palette,
    radii,
    spacing,
    typography,
} from '../../../../shared/components';
import { ApiError } from '../../../../core/api';
import { toast } from '../../../../shared/dialog';
import { purgeChatFromCaches } from '../../../../features/chats';
import { useCurrentUserId } from '../../../../features/auth';
import { deleteLocalChatMessages } from '../../../../shared/local-db';
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
import { useTheme, useThemedStyles } from '../../../../shared/theme';
import type { AppTheme } from '../../../../shared/theme';

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
    const theme = useTheme();
    const styles = useThemedStyles(createStyles);
    const queryClient = useQueryClient();
    const currentUserId = useCurrentUserId();
    const infoQuery = useGroupInfo(chatId);

    useGroupChangedEvents(chatId);
    useGroupUpdatedEvents();

    const handleRemoved = useCallback((): void => {
        purgeChatFromCaches(queryClient, chatId);
        toast.show('You were removed from this group');
        router.replace('/(app)');
    }, [queryClient, chatId]);
    useGroupRemovedEvent(chatId, handleRemoved);

    const bannedFromGroup =
        infoQuery.error instanceof ApiError &&
        infoQuery.error.statusCode === 403;
    const bannedHandled = useRef(false);
    useEffect((): void => {
        if (!bannedFromGroup || bannedHandled.current) return;
        bannedHandled.current = true;
        purgeChatFromCaches(queryClient, chatId);
        if (currentUserId !== null) {
            void deleteLocalChatMessages(currentUserId, chatId).catch(
                (): void => undefined,
            );
        }
    }, [bannedFromGroup, queryClient, chatId, currentUserId]);

    const info = infoQuery.data;
    const featureCount =
        info === undefined
            ? 0
            : visibleGroupSettingsFeatures(info.capabilities).length;
    const previousFeatureCount = useRef<number | null>(null);

    // `group:changed` refetches the info; if the caller LOST their last group
    // capability while this screen was open, leave instead of showing a stale
    // settings list.
    useEffect((): void => {
        if (info === undefined) return;
        const previous = previousFeatureCount.current;
        previousFeatureCount.current = featureCount;
        if (previous !== null && previous > 0 && featureCount === 0) {
            toast.show('You no longer have access to group settings');
            router.back();
        }
    }, [info, featureCount]);

    if (infoQuery.isPending) {
        return (
            <View style={styles.root}>
                <TopBar />
                <View style={styles.centered}>
                    <ActivityIndicator
                        size="large"
                        color={theme.accent}
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
        const banned = error instanceof ApiError && error.statusCode === 403;
        return (
            <View style={styles.root}>
                <TopBar />
                <SettingsState
                    title={
                        banned
                            ? "You can't access this group"
                            : 'Group settings unavailable'
                    }
                    detail={
                        privateChat
                            ? 'This screen is only available for groups.'
                            : banned
                              ? 'This group is no longer available to you.'
                              : 'Could not load this group.'
                    }
                    {...(privateChat || banned
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
                            <SafeText variant="title" lines={2}>
                                {info.title || 'Unnamed group'}
                            </SafeText>
                            <AppText style={styles.caption}>
                                Choose what you want to change.
                            </AppText>
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
                                <item.icon
                                    size={21}
                                    color={theme.colors.accentText}
                                    strokeWidth={1.8}
                                />
                            </View>
                            <View style={styles.rowBody}>
                                <AppText style={styles.rowTitle}>
                                    {item.title}
                                </AppText>
                                <AppText style={styles.rowSubtitle}>
                                    {item.subtitle}
                                </AppText>
                            </View>
                            <AppText style={styles.chevron}>›</AppText>
                        </Pressable>
                    )}
                />
            )}
        </View>
    );
}

function TopBar(): React.ReactElement {
    const styles = useThemedStyles(createStyles);
    return (
        <View style={styles.topBar}>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel="Go back"
                style={styles.backButton}
                onPress={(): void => router.back()}
            >
                <AppText style={styles.backText}>‹</AppText>
            </Pressable>
            <AppText style={styles.topBarTitle} numberOfLines={1}>
                Group settings
            </AppText>
            <View style={styles.topBarSpacer} />
        </View>
    );
}

function SettingsState(props: {
    title: string;
    detail: string;
    onRetry?: () => void;
}): React.ReactElement {
    const theme = useTheme();
    const styles = useThemedStyles(createStyles);
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
                    <AppText style={styles.retryText}>Retry</AppText>
                </Pressable>
            )}
            <Pressable
                accessibilityRole="button"
                accessibilityLabel="Go back"
                style={styles.backLink}
                onPress={(): void => router.back()}
            >
                <AppText style={styles.backLinkText}>Go back</AppText>
            </Pressable>
        </View>
    );
}

const createStyles = (theme: AppTheme) =>
    StyleSheet.create({
    root: { flex: 1, backgroundColor: 'transparent' },
    topBar: {
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 52,
        paddingHorizontal: spacing.xs,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.border,
        backgroundColor: theme.colors.glassElevated,
    },
    backButton: {
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
    },
    backText: { fontSize: 32, lineHeight: 34, color: theme.colors.text },
    topBarTitle: {
        flex: 1,
        textAlign: 'center',
        fontSize: 16,
        fontWeight: '700',
        color: theme.colors.text,
    },
    topBarSpacer: { width: 44 },
    list: { paddingVertical: spacing.md },
    listHeader: { paddingHorizontal: spacing.md, paddingBottom: spacing.md },
    caption: { ...theme.type.caption, marginTop: spacing.xxs },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        minHeight: 64,
        paddingHorizontal: spacing.md,
        backgroundColor: theme.colors.glassElevated,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.border,
    },
    rowPressed: { backgroundColor: theme.colors.glassElevated },
    rowIcon: {
        width: 36,
        height: 36,
        borderRadius: radii.full,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.accentSoft,
    },
    rowIconText: { fontSize: 18, color: theme.accent },
    rowBody: { flex: 1, gap: 2 },
    rowTitle: { fontSize: 16, fontWeight: '600', color: theme.colors.text },
    rowSubtitle: theme.type.caption,
    chevron: { fontSize: 26, color: theme.colors.textMuted },
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
        backgroundColor: theme.accent,
    },
    retryText: {
        color: theme.colors.accentText,
        fontSize: 14,
        fontWeight: '600',
    },
    backLink: { padding: spacing.sm },
    backLinkText: {
        fontSize: 14,
        fontWeight: '600',
        color: theme.accent,
    },
});
