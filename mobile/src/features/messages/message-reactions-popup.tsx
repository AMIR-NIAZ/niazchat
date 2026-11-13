import { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { UserAvatar } from '../../shared/components';
import { palette, radii, spacing, typography } from '../../shared/theme';
import type { ReactionGroupDto, ReactionUserDto } from '../../core/api';
import { fetchMessageReactions } from './messages-socket-api';
import type { ChatMessage } from './messages-model';

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
            <Text style={styles.title} accessibilityRole="header">
                {total > 0 ? `Reactions · ${total}` : 'Reactions'}
            </Text>
            {loading ? (
                <View style={styles.state}>
                    <ActivityIndicator
                        size="small"
                        color={palette.primary[500]}
                    />
                    <Text style={styles.stateText}>Loading reactions…</Text>
                </View>
            ) : error !== null ? (
                <View style={styles.state}>
                    <Text style={styles.errorText}>{error}</Text>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Retry loading reactions"
                        onPress={(): void =>
                            setReloadToken((value) => value + 1)
                        }
                        style={styles.retry}
                    >
                        <Text style={styles.retryText}>Retry</Text>
                    </Pressable>
                </View>
            ) : groups.length === 0 ? (
                <View style={styles.state}>
                    <Text style={styles.stateText}>No reactions yet</Text>
                </View>
            ) : (
                <ScrollView
                    style={styles.list}
                    contentContainerStyle={styles.listContent}
                >
                    {groups.map((group) => (
                        <View key={group.emoji} style={styles.group}>
                            <Text style={styles.groupTitle}>
                                {group.emoji} {group.count}
                            </Text>
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
                                            <Text
                                                style={styles.userName}
                                                numberOfLines={1}
                                            >
                                                {user.name}
                                                {self ? ' (you)' : ''}
                                            </Text>
                                            {user.username !== null &&
                                                user.username !== '' && (
                                                    <Text
                                                        style={styles.username}
                                                        numberOfLines={1}
                                                    >
                                                        @{user.username}
                                                    </Text>
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

const styles = StyleSheet.create({
    card: {
        flex: 1,
        backgroundColor: palette.elevated,
        borderRadius: radii.lg,
        borderWidth: StyleSheet.hairlineWidth * 2,
        borderColor: palette.border.strong,
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.md,
    },
    title: { ...typography.title, fontSize: 18 },
    state: {
        alignItems: 'center',
        gap: spacing.sm,
        paddingVertical: spacing.lg,
    },
    stateText: { color: palette.text.muted, fontSize: 14 },
    errorText: {
        color: palette.semantic.danger,
        fontSize: 14,
        textAlign: 'center',
    },
    retry: {
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.xs,
        borderRadius: radii.sm,
        backgroundColor: palette.primary[500],
    },
    retryText: { color: palette.text.onAccent, fontWeight: '700' },
    list: { marginTop: spacing.sm, flexGrow: 0 },
    listContent: { gap: spacing.md, paddingBottom: spacing.sm },
    group: { gap: spacing.xxs },
    groupTitle: {
        color: palette.text.secondary,
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
    userText: { flexShrink: 1 },
    userName: {
        color: palette.text.primary,
        fontSize: 14,
        fontWeight: '600',
    },
    username: { color: palette.text.muted, fontSize: 12 },
});
