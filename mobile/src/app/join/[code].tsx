import { useEffect, useState } from 'react';
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
    Screen,
    UserAvatar,
    palette,
    radii,
    spacing,
} from '../../shared/components';
import { useAuthStore } from '../../features/auth';
import { CHATS_QUERY_KEY } from '../../features/chats/use-chats';
import { describeInviteJoinError } from '../../features/groups/group-errors';
import {
    isInviteCode,
    type InvitePreview,
} from '../../features/groups/invite-links-model';
import {
    useInvitePreview,
    useJoinInvite,
} from '../../features/groups/use-invite-links';
import { setPendingInviteCode } from '../../features/groups/pending-invite';

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
                <ActivityIndicator size="large" color={palette.primary[500]} />
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
    const queryClient = useQueryClient();
    const previewQuery = useInvitePreview(code);
    const joinInvite = useJoinInvite(code);
    const [joinError, setJoinError] = useState<string | null>(null);

    const openChat = (chatId: number | null): void => {
        if (chatId === null) return;
        router.replace({
            pathname: '/(app)/chat/[chatId]',
            params: { chatId: String(chatId) },
        });
    };

    const join = async (): Promise<void> => {
        if (joinInvite.isPending) return;
        setJoinError(null);
        try {
            const result = await joinInvite.mutateAsync();
            await queryClient.invalidateQueries({
                queryKey: CHATS_QUERY_KEY,
            });
            openChat(result.chatId);
        } catch (error) {
            setJoinError(describeInviteJoinError(error));
        }
    };

    const preview = previewQuery.data;

    return (
        <Screen style={styles.screen} withTopInset={true}>
            <View style={styles.topBar}>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Back to chats"
                    style={styles.backButton}
                    onPress={(): void => router.replace('/(app)')}
                >
                    <Text style={styles.backText}>‹</Text>
                </Pressable>
                <Text style={styles.topBarTitle}>Join group</Text>
                <View style={styles.topBarSpacer} />
            </View>

            {previewQuery.isPending ? (
                <View style={styles.centered}>
                    <ActivityIndicator
                        size="large"
                        color={palette.primary[500]}
                    />
                    <AppText variant="caption">Opening invite link…</AppText>
                </View>
            ) : previewQuery.isError || preview === undefined ? (
                <View style={styles.centered}>
                    <Text style={styles.stateTitle}>
                        This invite link is invalid or has expired
                    </Text>
                    <Text style={styles.stateDetail}>
                        {describeInviteJoinError(previewQuery.error)}
                    </Text>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Retry opening invite link"
                        style={styles.primaryButton}
                        onPress={(): void => {
                            void previewQuery.refetch();
                        }}
                    >
                        <Text style={styles.primaryButtonText}>Retry</Text>
                    </Pressable>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Back to chats"
                        style={styles.linkButton}
                        onPress={(): void => router.replace('/(app)')}
                    >
                        <Text style={styles.linkButtonText}>Back to chats</Text>
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
                    onOpenChat={(): void => openChat(preview.chatId)}
                />
            )}
        </Screen>
    );
}

function JoinPreviewCard(props: {
    preview: InvitePreview;
    busy: boolean;
    error: string | null;
    onJoin: () => void;
    onOpenChat: () => void;
}): React.ReactElement {
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
                <Text style={styles.groupTitle} numberOfLines={3}>
                    {preview.title || 'Unnamed group'}
                </Text>
                {preview.description !== null &&
                    preview.description.trim() !== '' && (
                        <Text style={styles.groupDescription}>
                            {preview.description}
                        </Text>
                    )}
                <Text style={styles.memberCount}>{memberLabel}</Text>
                <Text style={styles.inviteHint}>
                    You were invited to join this group on niazchat.
                </Text>

                {props.error !== null && (
                    <Text
                        style={styles.errorText}
                        accessibilityLiveRegion="polite"
                    >
                        {props.error}
                    </Text>
                )}

                {preview.alreadyMember ? (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Open chat"
                        onPress={props.onOpenChat}
                        style={({ pressed }) => [
                            styles.primaryButton,
                            styles.wideButton,
                            pressed && styles.primaryButtonPressed,
                        ]}
                    >
                        <Text style={styles.primaryButtonText}>Open chat</Text>
                    </Pressable>
                ) : (
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
                                color={palette.neutral[0]}
                            />
                        ) : (
                            <Text style={styles.primaryButtonText}>
                                Join group
                            </Text>
                        )}
                    </Pressable>
                )}
            </View>
        </View>
    );
}

function InvalidInvite({ message }: { message: string }): React.ReactElement {
    return (
        <Screen style={styles.screen} withTopInset={true}>
            <View style={styles.centered}>
                <Text style={styles.stateTitle}>{message}</Text>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Back to chats"
                    style={styles.primaryButton}
                    onPress={(): void => router.replace('/(app)')}
                >
                    <Text style={styles.primaryButtonText}>Back to chats</Text>
                </Pressable>
            </View>
        </Screen>
    );
}

const styles = StyleSheet.create({
    screen: {
        flex: 1,
        backgroundColor: palette.neutral[50],
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
        borderBottomColor: palette.neutral[100],
        backgroundColor: palette.neutral[0],
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
        color: palette.neutral[900],
    },
    topBarTitle: {
        flex: 1,
        textAlign: 'center',
        fontSize: 16,
        fontWeight: '700',
        color: palette.neutral[900],
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
        backgroundColor: palette.neutral[0],
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: palette.neutral[100],
    },
    groupTitle: {
        marginTop: spacing.xs,
        textAlign: 'center',
        fontSize: 22,
        fontWeight: '700',
        color: palette.neutral[900],
    },
    groupDescription: {
        textAlign: 'center',
        fontSize: 14,
        lineHeight: 20,
        color: palette.neutral[500],
    },
    memberCount: {
        color: palette.neutral[500],
        fontSize: 14,
        fontWeight: '600',
    },
    inviteHint: {
        marginTop: spacing.xxs,
        textAlign: 'center',
        color: palette.neutral[500],
        fontSize: 13,
    },
    stateTitle: {
        textAlign: 'center',
        fontSize: 17,
        fontWeight: '600',
        color: palette.neutral[700],
    },
    stateDetail: {
        textAlign: 'center',
        color: palette.neutral[500],
        fontSize: 13,
    },
    errorText: {
        textAlign: 'center',
        color: palette.semantic.danger,
        fontSize: 13,
    },
    primaryButton: {
        marginTop: spacing.xs,
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 44,
        borderRadius: radii.sm,
        paddingHorizontal: spacing.lg,
        backgroundColor: palette.primary[500],
    },
    primaryButtonPressed: { opacity: 0.85 },
    primaryButtonDisabled: { opacity: 0.45 },
    wideButton: { alignSelf: 'stretch' },
    primaryButtonText: {
        color: palette.neutral[0],
        fontSize: 15,
        fontWeight: '600',
    },
    linkButton: { padding: spacing.sm },
    linkButtonText: {
        color: palette.primary[700],
        fontSize: 14,
        fontWeight: '600',
    },
});
