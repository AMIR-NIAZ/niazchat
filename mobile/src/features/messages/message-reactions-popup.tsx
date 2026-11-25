import { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { SafeText, UserAvatar,
    AppText,
} from '../../shared/components';
import { palette, radii, spacing, typography } from '../../shared/theme';
import type { ReactionGroupDto, ReactionUserDto } from '../../core/api';
import { fetchMessageReactions } from './messages-socket-api';
import type { ChatMessage } from './messages-model';
import { useTheme, useThemedStyles } from '../../shared/theme';
import type { AppTheme } from '../../shared/theme';

/**
 * Reactor list for one message (`getMessageReactions`), rendered as the centered
 * popup card. Tapping another user delegates navigation to the caller; the
 * caller's own row is not navigable.
 */
export function MessageReactionsCard({
    chatId,
    message,
    currentUserId,
    onOpenUser,
}: {
    chatId: number;
    message: ChatMessage;
    currentUserId: number | null;
    onOpenUser: (user: ReactionUserDto) => void;
}): React.ReactElement {
    const theme = useTheme();
    const styles = useThemedStyles(createStyles);
    const messageId = message.id;
    const [groups, setGroups] = useState<ReactionGroupDto[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [reloadToken, setReloadToken] = useState(0);

    useEffect((): (() => void) | undefined => {
        if (messageId === null) {
            setGroups([]);
            setLoading(false);
            return undefined;
        }
        let cancelled = false;
        setLoading(true);
        setError(null);
        void fetchMessageReactions(chatId, messageId)
            .then((result) => {
                if (cancelled) return;
                setGroups(result?.reactions ?? []);
            })
            .catch((reason: unknown) => {
                if (cancelled) return;
                setGroups([]);
                setError(
                    reason instanceof Error
                        ? reason.message
                        : 'Could not load reactions.',
                );
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return (): void => {
            cancelled = true;
        };
    }, [chatId, messageId, reloadToken]);

    const total = groups.reduce((sum, group) => sum + group.count, 0);

    return (
        <View style={styles.card} accessibilityViewIsModal={true}>
            <AppText style={styles.title} accessibilityRole="header">
                {total > 0 ? `Reactions · ${total}` : 'Reactions'}
            </AppText>
            {loading ? (
                <View style={styles.state}>
                    <ActivityIndicator
                        size="small"
                        color={theme.accent}
                    />
                    <AppText style={styles.stateText}>Loading reactions…</AppText>
                </View>
            ) : error !== null ? (
                <View style={styles.state}>
                    <AppText style={styles.errorText}>{error}</AppText>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Retry loading reactions"
                        onPress={(): void =>
                            setReloadToken((value) => value + 1)
                        }
                        style={styles.retry}
                    >
                        <AppText style={styles.retryText}>Retry</AppText>
                    </Pressable>
                </View>
            ) : groups.length === 0 ? (
                <View style={styles.state}>
                    <AppText style={styles.stateText}>No reactions yet</AppText>
                </View>
            ) : (
                <ScrollView
                    style={styles.list}
                    contentContainerStyle={styles.listContent}
                >
                    {groups.map((group) => (
                        <View key={group.emoji} style={styles.group}>
                            <AppText style={styles.groupTitle}>
                                {group.emoji} {group.count}
                            </AppText>
                            {group.users.map((user) => {
                                const self =
                                    currentUserId !== null &&
                                    Number(user.userId) ===
                                        Number(currentUserId);
                                return (
                                    <Pressable
                                        key={String(user.userId)}
                                        accessibilityRole={
                                            self ? 'text' : 'button'
                                        }
                                        accessibilityLabel={
                                            self
                                                ? `${user.name}, you`
                                                : `Open profile of ${user.name}`
                                        }
                                        disabled={self}
                                        onPress={(): void => onOpenUser(user)}
                                        style={({ pressed }) => [
                                            styles.userRow,
                                            pressed && styles.pressed,
                                        ]}
                                    >
                                        <UserAvatar
                                            userId={Number(user.userId)}
                                            name={user.name}
                                            uri={user.avatars[0]}
                                            size={36}
                                        />
                                        <View style={styles.userText}>
                                            <SafeText
                                                style={styles.userName}
                                                lines={1}
                                            >
                                                {user.name}
                                                {self ? ' (you)' : ''}
                                            </SafeText>
                                            {user.username !== null &&
                                                user.username !== '' && (
                                                    <AppText
                                                        style={styles.username}
                                                        numberOfLines={1}
                                                    >
                                                        @{user.username}
                                                    </AppText>
                                                )}
                                        </View>
                                    </Pressable>
                                );
                            })}
                        </View>
                    ))}
                </ScrollView>
            )}
        </View>
    );
}

const createStyles = (theme: AppTheme) =>
    StyleSheet.create({
    card: {
        flex: 1,
        backgroundColor: theme.colors.glassElevated,
        borderRadius: radii.lg,
        borderWidth: StyleSheet.hairlineWidth * 2,
        borderColor: theme.colors.borderStrong,
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.md,
    },
    title: { ...theme.type.title, fontSize: 18 },
    state: {
        alignItems: 'center',
        gap: spacing.sm,
        paddingVertical: spacing.lg,
    },
    stateText: { color: theme.colors.textMuted, fontSize: 14 },
    errorText: {
        color: theme.colors.danger,
        fontSize: 14,
        textAlign: 'center',
    },
    retry: {
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.xs,
        borderRadius: radii.sm,
        backgroundColor: theme.accent,
    },
    retryText: { color: theme.colors.accentText, fontWeight: '700' },
    list: { marginTop: spacing.sm, flexGrow: 0 },
    listContent: { gap: spacing.md, paddingBottom: spacing.sm },
    group: { gap: spacing.xxs },
    groupTitle: {
        color: theme.colors.textSecondary,
        fontSize: 14,
        fontWeight: '700',
    },
    userRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        paddingVertical: spacing.xs,
    },
    pressed: { opacity: 0.6 },
    userText: { flexShrink: 1, minWidth: 0 },
    userName: {
        color: theme.colors.text,
        fontSize: 14,
        fontWeight: '600',
    },
    username: { color: theme.colors.textMuted, fontSize: 12 },
});
