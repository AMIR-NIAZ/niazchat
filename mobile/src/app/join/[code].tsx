import { useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Pressable,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import {
    AppText,
    SafeText,
    Screen,
    UserAvatar,
    palette,
    radii,
    spacing,
} from '../../shared/components';
import { toast } from '../../shared/dialog';
import { ApiError } from '../../core/api';
import { useAuthStore } from '../../features/auth';
import { CHATS_QUERY_KEY } from '../../features/chats/use-chats';
import { describeInviteJoinError } from '../../features/groups/group-errors';
import { useGroupMembership } from '../../features/groups/use-group-membership';
import { groupInfoQueryKey } from '../../features/groups/group-model';
import {
    isInviteCode,
    type InvitePreview,
} from '../../features/groups/invite-links-model';
import {
    useInvitePreview,
    useJoinInvite,
} from '../../features/groups/use-invite-links';
import { setPendingInviteCode } from '../../features/groups/pending-invite';
import { useTheme, useThemedStyles } from '../../shared/theme';
import type { AppTheme } from '../../shared/theme';

/**
 * Join screen (`/join/:code`) — outside the protected group so a deep link can
 * land here. Logged-out users are sent through login with the code kept in
 * memory; the guest-only auth guard returns them here afterwards. This
 * continuation does not survive an app kill by design.
 */

type RouteParams = { code?: string | string[] };

function parseCode(value: string | string[] | undefined): string {
    const raw = Array.isArray(value) ? value[0] : value;
    return typeof raw === 'string' ? raw : '';
}

export default function JoinScreen(): React.ReactElement {
    const theme = useTheme();
    const styles = useThemedStyles(createStyles);
    const params = useLocalSearchParams<RouteParams>();
    const code = parseCode(params.code);
    const status = useAuthStore((state) => state.status);

    useEffect((): void => {
        if (status !== 'guest') return;
        setPendingInviteCode(code);
        router.replace('/(auth)/login');
    }, [status, code]);

    if (status === 'restoring' || status === 'guest') {
        return (
            <Screen style={styles.centered} withTopInset={true}>
                <ActivityIndicator size="large" color={theme.accent} />
            </Screen>
        );
    }

    if (!isInviteCode(code)) {
        return (
            <InvalidInvite message="This invite link is invalid or has expired" />
        );
    }

    return <JoinPanel code={code} />;
}

function JoinPanel({ code }: { code: string }): React.ReactElement {
    const theme = useTheme();
    const styles = useThemedStyles(createStyles);
    const queryClient = useQueryClient();
    const previewQuery = useInvitePreview(code);
    const joinInvite = useJoinInvite(code);
    const [joinError, setJoinError] = useState<string | null>(null);

    const preview = previewQuery.data;
    // The preview already carries the caller's server answer, so a member is
    // decided before any join UI renders; the cached chat list is the offline
    // fallback for a cold preview.
    const membership = useGroupMembership(preview?.chatId ?? null, {
        hint:
            preview === undefined
                ? null
                : { isMember: preview.isMember, myRole: preview.myRole },
    });
    const redirectedRef = useRef(false);

    const openChat = (chatId: number | null): void => {
        if (chatId === null) return;
        router.replace({
            pathname: '/(app)/chat/[chatId]',
            params: { chatId: String(chatId) },
        });
    };

    // Members go straight into the chat: no join screen, no dialog.
    useEffect((): void => {
        if (
            redirectedRef.current ||
            membership !== 'member' ||
            preview === undefined ||
            preview.chatId === null
        ) {
            return;
        }
        redirectedRef.current = true;
        toast.show("You're already a member");
        router.replace({
            pathname: '/(app)/chat/[chatId]',
            params: { chatId: String(preview.chatId) },
        });
    }, [membership, preview]);

    const join = async (): Promise<void> => {
        if (joinInvite.isPending) return;
        setJoinError(null);
        try {
            const result = await joinInvite.mutateAsync();
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: CHATS_QUERY_KEY }),
                queryClient.invalidateQueries({
                    queryKey: groupInfoQueryKey(result.chatId),
                }),
            ]);
            if (result.alreadyMember) {
                toast.show("You're already a member");
            }
            openChat(result.chatId);
        } catch (error) {
            // Defensive: an older backend may answer "already a member" as an
            // error. Treat it as success and open the chat (idempotent join).
            if (isAlreadyMemberError(error) && preview?.chatId != null) {
                const chatId = preview.chatId;
                await queryClient.invalidateQueries({
                    queryKey: CHATS_QUERY_KEY,
                });
                toast.show("You're already a member");
                openChat(chatId);
                return;
            }
            setJoinError(describeInviteJoinError(error));
        }
    };

    const banned =
        membership === 'banned' ||
        (previewQuery.isError &&
            previewQuery.error instanceof ApiError &&
            previewQuery.error.statusCode === 403);

    return (
        <Screen style={styles.screen} withTopInset={true}>
            <View style={styles.topBar}>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Back to chats"
                    style={styles.backButton}
                    onPress={(): void => router.replace('/(app)')}
                >
                    <AppText style={styles.backText}>‹</AppText>
                </Pressable>
                <AppText style={styles.topBarTitle}>Join group</AppText>
                <View style={styles.topBarSpacer} />
            </View>

            {previewQuery.isPending ||
            membership === 'unknown' ||
            membership === 'member' ? (
                <View style={styles.centered}>
                    <ActivityIndicator
                        size="large"
                        color={theme.accent}
                    />
                    <AppText variant="caption">Opening invite link…</AppText>
                </View>
            ) : banned ? (
                <View style={styles.centered}>
                    <AppText style={styles.stateTitle}>
                        You can't join this group
                    </AppText>
                    <AppText style={styles.stateDetail}>
                        Ask an admin to unban you before you try again.
                    </AppText>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Back to chats"
                        style={styles.primaryButton}
                        onPress={(): void => router.replace('/(app)')}
                    >
                        <AppText style={styles.primaryButtonText}>
                            Back to chats
                        </AppText>
                    </Pressable>
                </View>
            ) : previewQuery.isError || preview === undefined ? (
                <View style={styles.centered}>
                    <AppText style={styles.stateTitle}>
                        This invite link is invalid or has expired
                    </AppText>
                    <AppText style={styles.stateDetail}>
                        {describeInviteJoinError(previewQuery.error)}
                    </AppText>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Retry opening invite link"
                        style={styles.primaryButton}
                        onPress={(): void => {
                            void previewQuery.refetch();
                        }}
                    >
                        <AppText style={styles.primaryButtonText}>Retry</AppText>
                    </Pressable>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Back to chats"
                        style={styles.linkButton}
                        onPress={(): void => router.replace('/(app)')}
                    >
                        <AppText style={styles.linkButtonText}>Back to chats</AppText>
                    </Pressable>
                </View>
            ) : (
                <JoinPreviewCard
                    preview={preview}
                    busy={joinInvite.isPending}
                    error={joinError}
                    onJoin={(): void => {
                        void join();
                    }}
                />
            )}
        </Screen>
    );
}

function isAlreadyMemberError(error: unknown): boolean {
    return (
        error instanceof ApiError &&
        (error.statusCode === 400 || error.statusCode === 409) &&
        /already a member/i.test(error.message)
    );
}

function JoinPreviewCard(props: {
    preview: InvitePreview;
    busy: boolean;
    error: string | null;
    onJoin: () => void;
}): React.ReactElement {
    const theme = useTheme();
    const styles = useThemedStyles(createStyles);
    const { preview } = props;
    const memberLabel = `${preview.membersCount} member${
        preview.membersCount === 1 ? '' : 's'
    }`;

    return (
        <View style={styles.cardWrap}>
            <View style={styles.card}>
                <UserAvatar
                    userId={preview.chatId ?? 0}
                    name={preview.title || 'Group'}
                    uri={preview.avatar}
                    size={96}
                />
                <SafeText style={styles.groupTitle} lines={3}>
                    {preview.title || 'Unnamed group'}
                </SafeText>
                {preview.description !== null &&
                    preview.description.trim() !== '' && (
                        <AppText style={styles.groupDescription}>
                            {preview.description}
                        </AppText>
                    )}
                <AppText style={styles.memberCount}>{memberLabel}</AppText>
                <AppText style={styles.inviteHint}>
                    You were invited to join this group on niazchat.
                </AppText>

                {props.error !== null && (
                    <AppText
                        style={styles.errorText}
                        accessibilityLiveRegion="polite"
                    >
                        {props.error}
                    </AppText>
                )}

                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Join group"
                    accessibilityState={{ disabled: props.busy }}
                    disabled={props.busy}
                    onPress={props.onJoin}
                    style={({ pressed }) => [
                        styles.primaryButton,
                        styles.wideButton,
                        pressed && styles.primaryButtonPressed,
                        props.busy && styles.primaryButtonDisabled,
                    ]}
                >
                    {props.busy ? (
                        <ActivityIndicator
                            size="small"
                            color={theme.colors.accentText}
                        />
                    ) : (
                        <AppText style={styles.primaryButtonText}>Join group</AppText>
                    )}
                </Pressable>
            </View>
        </View>
    );
}

function InvalidInvite({ message }: { message: string }): React.ReactElement {
    const theme = useTheme();
    const styles = useThemedStyles(createStyles);
    return (
        <Screen style={styles.screen} withTopInset={true}>
            <View style={styles.centered}>
                <AppText style={styles.stateTitle}>{message}</AppText>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Back to chats"
                    style={styles.primaryButton}
                    onPress={(): void => router.replace('/(app)')}
                >
                    <AppText style={styles.primaryButtonText}>Back to chats</AppText>
                </Pressable>
            </View>
        </Screen>
    );
}

const createStyles = (theme: AppTheme) =>
    StyleSheet.create({
    screen: {
        flex: 1,
        backgroundColor: 'transparent',
    },
    centered: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.sm,
        paddingHorizontal: spacing.lg,
    },
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
    backText: {
        fontSize: 32,
        lineHeight: 34,
        color: theme.colors.text,
    },
    topBarTitle: {
        flex: 1,
        textAlign: 'center',
        fontSize: 16,
        fontWeight: '700',
        color: theme.colors.text,
    },
    topBarSpacer: { width: 44 },
    cardWrap: {
        flex: 1,
        justifyContent: 'center',
        padding: spacing.md,
    },
    card: {
        alignItems: 'center',
        gap: spacing.xs,
        padding: spacing.lg,
        borderRadius: radii.md,
        backgroundColor: theme.colors.glassElevated,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.border,
    },
    groupTitle: {
        alignSelf: 'stretch',
        marginTop: spacing.xs,
        textAlign: 'center',
        fontSize: 22,
        fontWeight: '700',
        color: theme.colors.text,
    },
    groupDescription: {
        textAlign: 'center',
        fontSize: 14,
        lineHeight: 20,
        color: theme.colors.textSecondary,
    },
    memberCount: {
        color: theme.colors.textSecondary,
        fontSize: 14,
        fontWeight: '600',
    },
    inviteHint: {
        marginTop: spacing.xxs,
        textAlign: 'center',
        color: theme.colors.textSecondary,
        fontSize: 13,
    },
    stateTitle: {
        textAlign: 'center',
        fontSize: 17,
        fontWeight: '600',
        color: theme.colors.text,
    },
    stateDetail: {
        textAlign: 'center',
        color: theme.colors.textSecondary,
        fontSize: 13,
    },
    errorText: {
        textAlign: 'center',
        color: theme.colors.danger,
        fontSize: 13,
    },
    primaryButton: {
        marginTop: spacing.xs,
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 44,
        borderRadius: radii.sm,
        paddingHorizontal: spacing.lg,
        backgroundColor: theme.accent,
    },
    primaryButtonPressed: { opacity: 0.85 },
    primaryButtonDisabled: { opacity: 0.45 },
    wideButton: { alignSelf: 'stretch' },
    primaryButtonText: {
        color: theme.colors.accentText,
        fontSize: 15,
        fontWeight: '600',
    },
    linkButton: { padding: spacing.sm },
    linkButtonText: {
        color: theme.accent,
        fontSize: 14,
        fontWeight: '600',
    },
});
