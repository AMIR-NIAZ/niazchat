import { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Modal,
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

interface MessageReactionsSheetProps {
    chatId: number;
    target: ChatMessage | null;
    currentUserId: number | null;
    onClose: () => void;
    onOpenUser: (user: ReactionUserDto) => void;
}

/**
 * Grouped reactor list for one message (`getMessageReactions`). Tapping another
 * user delegates navigation to the caller; the current user is not navigable.
 */
export function MessageReactionsSheet(
    props: MessageReactionsSheetProps,
): React.ReactElement {
    const { chatId, target, currentUserId, onClose, onOpenUser } = props;
    const messageId = target?.id ?? null;
    const [groups, setGroups] = useState<ReactionGroupDto[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [reloadToken, setReloadToken] = useState(0);

    useEffect((): (() => void) | void => {
        if (messageId === null || target === null) {
            setGroups([]);
            setError(null);
            setLoading(false);
            return;
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
    }, [chatId, target, messageId, reloadToken]);

    if (target === null) {
        return <View />;
    }

    return (
        <Modal
            visible={true}
            transparent={true}
            animationType="slide"
            onRequestClose={onClose}
        >
            <Pressable style={styles.backdrop} onPress={onClose}>
                <Pressable style={styles.card}>
                    <View style={styles.header}>
                        <Text style={typography.title}>Reactions</Text>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Close reactions"
                            onPress={onClose}
                            style={styles.close}
                        >
                            <Text style={styles.closeText}>Close</Text>
                        </Pressable>
                    </View>
                    {loading ? (
                        <View style={styles.state}>
                            <ActivityIndicator
                                size="small"
                                color={palette.primary[500]}
                            />
                            <Text style={styles.stateText}>
                                Loading reactions…
                            </Text>
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
                            <Text style={styles.stateText}>
                                No reactions yet
                            </Text>
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
                                                    self ? undefined : 'button'
                                                }
                                                accessibilityLabel={
                                                    self
                                                        ? `${user.name}, you`
                                                        : `Open profile of ${user.name}`
                                                }
                                                disabled={self}
                                                onPress={(): void =>
                                                    onOpenUser(user)
                                                }
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
                                                        user.username !==
                                                            '' && (
                                                            <Text
                                                                style={
                                                                    styles.username
                                                                }
                                                                numberOfLines={
                                                                    1
                                                                }
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
                </Pressable>
            </Pressable>
        </Modal>
    );
}

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
        backgroundColor: 'rgba(12, 18, 24, 0.42)',
        justifyContent: 'flex-end',
        padding: spacing.md,
    },
    card: {
        maxHeight: '72%',
        backgroundColor: palette.elevated,
        borderRadius: radii.lg,
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.md,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: spacing.md,
    },
    close: {
        paddingVertical: spacing.xxs,
        paddingHorizontal: spacing.xs,
    },
    closeText: { color: palette.primary[600], fontWeight: '700' },
    state: {
        alignItems: 'center',
        gap: spacing.sm,
        paddingVertical: spacing.lg,
    },
    stateText: { color: palette.neutral[500], fontSize: 14 },
    errorText: { color: palette.semantic.danger, fontSize: 14 },
    retry: {
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.xs,
        borderRadius: radii.sm,
        backgroundColor: palette.primary[500],
    },
    retryText: { color: palette.text.onAccent, fontWeight: '700' },
    list: { marginTop: spacing.sm },
    listContent: { gap: spacing.md, paddingBottom: spacing.sm },
    group: { gap: spacing.xxs },
    groupTitle: {
        color: palette.neutral[700],
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
    userName: { color: palette.neutral[900], fontSize: 14, fontWeight: '600' },
    username: { color: palette.neutral[500], fontSize: 12 },
});
