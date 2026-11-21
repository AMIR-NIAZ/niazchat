import { useEffect, useRef, useState } from 'react';
import type { ComponentRef } from 'react';
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
    Ban,
    EllipsisVertical,
    Trash2,
    UserMinus,
    UserPlus,
} from 'lucide-react-native';
import {
    AppText,
    Avatar,
    GlassCard,
    GlassHeader,
    SafeText,
    Screen,
    palette,
    radii,
    spacing,
    typography,
} from '../../../shared/components';
import { AvatarViewer } from '../../../features/users/avatar-gallery';
import { presenceLabel } from '../../../features/users/public-profile-model';
import { useRegisterOpenUserProfile } from '../../../features/users/profile-navigation';
import { hideUserProfileEverywhere } from '../../../features/users/visibility-cache';
import { useUserProfile } from '../../../features/users/use-user-profile';
import { describePublicProfileError } from '../../../features/users/users-service';
import { useCurrentUserId } from '../../../features/auth';
import {
    blockChatPeer,
    createPrivateChat,
    deleteChatForBoth,
    deleteChatForMe,
    findPrivateChatWithPeer,
    openPrivateChat,
    purgeChatFromCaches,
    unblockChatPeer,
    useCachedChats,
} from '../../../features/chats';
import {
    measureInWindow,
    useContextPopup,
} from '../../../shared/context-popup';
import type { ContextMenuItem } from '../../../shared/context-popup';
import { dialog, toast } from '../../../shared/dialog';
import { ApiError } from '../../../core/api';
import { deleteLocalChatMessages } from '../../../shared/local-db';
import {
    useAddContact,
    useContacts,
    useRemoveContact,
} from '../../../features/contacts/use-contacts';
import { ChatSharedContent } from '../../../features/shared-content';

/**
 * User info screen (`GET /user/:userId/profile`).
 *
 * Opened from a chat: the sender's avatar or name. The `name` / `avatar` route
 * params are the chat's existing knowledge, so the header and the big avatar
 * paint immediately while the full profile loads.
 *
 * Only public fields are shown (no phone, no account status). The photo viewer
 * is the read-only variant: swipe between every photo, "Photo 2 of 4", no
 * promote/delete. Only there is the ORIGINAL file downloaded.
 */

type UserRouteParams = {
    userId?: string | string[];
    name?: string | string[];
    avatar?: string | string[];
};

function firstParam(value: string | string[] | undefined): string | null {
    const raw = Array.isArray(value) ? value[0] : value;
    if (raw === undefined) {
        return null;
    }
    const trimmed = raw.trim();
    return trimmed === '' ? null : trimmed;
}

function parseUserId(value: string | string[] | undefined): number | null {
    const raw = firstParam(value);
    if (raw === null) {
        return null;
    }
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export default function UserProfileScreen(): React.ReactElement {
    const params = useLocalSearchParams<UserRouteParams>();
    const userId = parseUserId(params.userId);

    if (userId === null) {
        return <InvalidUser />;
    }
    return (
        <UserProfile
            userId={userId}
            initialName={firstParam(params.name)}
            initialAvatar={firstParam(params.avatar)}
        />
    );
}

interface UserProfileProps {
    userId: number;
    initialName: string | null;
    initialAvatar: string | null;
}

function UserProfile({
    userId,
    initialName,
    initialAvatar,
}: UserProfileProps): React.ReactElement {
    // Guarded navigation must know this screen is the open one.
    useRegisterOpenUserProfile(userId);
    const query = useUserProfile(userId);
    const queryClient = useQueryClient();
    const currentUserId = useCurrentUserId();
    const isSelf = currentUserId !== null && currentUserId === userId;
    const [viewerIndex, setViewerIndex] = useState<number | null>(null);
    const [messagePending, setMessagePending] = useState(false);
    const [messageError, setMessageError] = useState<string | null>(null);
    const savedContacts = useContacts();
    const addContact = useAddContact();
    const removeContact = useRemoveContact();
    const popup = useContextPopup();
    const menuButtonRef = useRef<ComponentRef<typeof View>>(null);
    /** One header action at a time: repeated taps are ignored. */
    const [actionPending, setActionPending] = useState(false);
    const actionBusyRef = useRef(false);
    // Cached list row for this user (if any) carries the block state. Reading
    // the cache only — no fetch is started by this screen.
    const cachedChats = useCachedChats();
    const chat = findPrivateChatWithPeer(cachedChats, userId);
    const [blockedByMe, setBlockedByMe] = useState(false);

    const profile = query.profile;
    const unavailable =
        query.error instanceof ApiError && query.error.statusCode === 404;
    const hiddenHandled = useRef(false);

    // Follow the cache's directional block flag (updated by chat:blocked events
    // while this screen is open).
    useEffect((): void => {
        setBlockedByMe(chat?.blockedByMe === true);
    }, [chat?.id, chat?.blockedByMe]);

    // The server hides this profile (its owner blocked the viewer). Overwrite
    // every cached copy ONCE so a stale photo does not survive offline.
    useEffect((): void => {
        if (!unavailable || hiddenHandled.current) return;
        hiddenHandled.current = true;
        hideUserProfileEverywhere(
            queryClient,
            currentUserId,
            userId,
            initialName ?? 'Profile',
        );
    }, [unavailable, queryClient, currentUserId, userId, initialName]);

    if (unavailable) {
        return <UnavailableProfile userId={userId} />;
    }

    const name = profile?.name ?? initialName ?? 'Profile';
    const avatars = profile?.avatars ?? [];
    const currentAvatarPath = avatars[0]?.storedPath ?? initialAvatar;
    const presence = profile === null ? null : presenceLabel(profile);
    const bio = profile?.biografy?.trim();
    const savedContact = savedContacts.contacts.find(
        (contact) => contact.userId === userId,
    );
    const isSavedContact = savedContact !== undefined;

    /** Runs one menu action with the shared busy guard and failure toast. */
    const runAction = async (task: () => Promise<void>): Promise<void> => {
        if (actionBusyRef.current) return;
        actionBusyRef.current = true;
        setActionPending(true);
        try {
            await task();
        } catch (error) {
            toast.show(
                error instanceof Error && error.message.trim() !== ''
                    ? error.message
                    : 'Something went wrong. Try again.',
                { tone: 'danger' },
            );
        } finally {
            actionBusyRef.current = false;
            setActionPending(false);
        }
    };

    const handleAddContact = (): void => {
        void runAction(async (): Promise<void> => {
            try {
                await addContact.mutateAsync({
                    userId,
                    preview: {
                        userId,
                        name: profile?.name ?? name,
                        username: profile?.username ?? null,
                        avatarUrl: avatars[0]?.url ?? null,
                    },
                });
                toast.show('Added to contacts', { tone: 'success' });
            } catch (error) {
                if (error instanceof ApiError && error.statusCode === 409) {
                    // The contact already exists server-side: refresh so the
                    // menu offers "Remove from contacts".
                    savedContacts.refetch();
                    toast.show('Already in your contacts');
                    return;
                }
                throw error;
            }
        });
    };

    const handleRemoveContact = (): void => {
        if (savedContact === undefined) return;
        void (async (): Promise<void> => {
            const confirmed = await dialog.confirm({
                title: `Remove ${name} from contacts?`,
                message:
                    'They will be removed from your saved contacts. This does not affect your chat.',
                confirmText: 'Remove',
                destructive: true,
            });
            if (!confirmed) return;
            await runAction(async (): Promise<void> => {
                // A still-optimistic row has no server id yet; wait for the
                // list instead of deleting a local placeholder id.
                if (savedContact.id <= 0) {
                    savedContacts.refetch();
                    return;
                }
                try {
                    await removeContact.mutateAsync(savedContact.id);
                    toast.show('Removed from contacts', { tone: 'success' });
                } catch (error) {
                    if (error instanceof ApiError && error.statusCode === 404) {
                        savedContacts.refetch();
                    }
                    throw error;
                }
            });
        })();
    };

    /** Existing chat with this user, or the server's idempotent chat row. */
    const resolveChatId = async (): Promise<number> => {
        if (chat !== null) {
            return Number(chat.id);
        }
        const created = await createPrivateChat(userId);
        return created.chatId;
    };

    const handleToggleBlock = (): void => {
        const willBlock = !blockedByMe;
        void (async (): Promise<void> => {
            if (willBlock) {
                const confirmed = await dialog.confirm({
                    title: `Block ${name}?`,
                    message:
                        'They will no longer be able to send you messages. Existing messages stay, and you can unblock them at any time.',
                    confirmText: 'Block',
                    destructive: true,
                });
                if (!confirmed) return;
            }
            await runAction(async (): Promise<void> => {
                const chatId = await resolveChatId();
                const result = willBlock
                    ? await blockChatPeer(chatId)
                    : await unblockChatPeer(chatId);
                if (result !== null) {
                    setBlockedByMe(result.blockedByMe);
                }
                toast.show(willBlock ? 'User blocked' : 'User unblocked');
            });
        })();
    };

    /** Pops the profile (and the chat underneath) after a chat is deleted. */
    const leaveDeletedChat = (): void => {
        if (router.canDismiss()) {
            router.dismissAll();
            return;
        }
        router.replace('/(app)');
    };

    const deleteChat = (forBoth: boolean): void => {
        if (chat === null) return;
        const chatId = Number(chat.id);
        void (async (): Promise<void> => {
            const confirmed = await dialog.confirm(
                forBoth
                    ? {
                          title: 'Delete chat for both?',
                          message: `This permanently deletes the conversation and all of its messages for you and ${name}. This cannot be undone.`,
                          confirmText: 'Delete for both',
                          destructive: true,
                      }
                    : {
                          title: 'Delete chat for me?',
                          message:
                              'This removes the conversation and its messages from your account only. The other person keeps their copy and is not notified.',
                          confirmText: 'Delete',
                          destructive: true,
                      },
            );
            if (!confirmed) return;
            await runAction(async (): Promise<void> => {
                if (forBoth) {
                    await deleteChatForBoth(chatId);
                } else {
                    await deleteChatForMe(chatId);
                }
                purgeChatFromCaches(queryClient, chatId);
                if (currentUserId !== null) {
                    void deleteLocalChatMessages(currentUserId, chatId).catch(
                        (): void => undefined,
                    );
                }
                toast.show(
                    forBoth ? 'Chat deleted for both' : 'Chat deleted for you',
                    { tone: 'success' },
                );
                leaveDeletedChat();
            });
        })();
    };

    const openMenu = async (): Promise<void> => {
        if (actionBusyRef.current) return;
        const anchor = await measureInWindow(menuButtonRef);
        if (anchor === null) return;
        const actions: ContextMenuItem[] = [
            {
                id: 'contact-toggle',
                label: isSavedContact
                    ? 'Remove from contacts'
                    : 'Add to contacts',
                icon: isSavedContact ? UserMinus : UserPlus,
                onPress: isSavedContact
                    ? handleRemoveContact
                    : handleAddContact,
            },
            {
                id: 'block-toggle',
                label: blockedByMe ? 'Unblock' : 'Block',
                icon: Ban,
                onPress: handleToggleBlock,
            },
        ];
        // Nothing to delete when there is no conversation yet.
        if (chat !== null) {
            actions.push(
                {
                    id: 'delete-for-me',
                    label: 'Delete for me',
                    icon: Trash2,
                    destructive: true,
                    onPress: (): void => deleteChat(false),
                },
                {
                    id: 'delete-for-both',
                    label: 'Delete for both',
                    icon: Trash2,
                    destructive: true,
                    onPress: (): void => deleteChat(true),
                },
            );
        }
        // `align: 'end'` keeps the card inside the window under the trailing
        // header button, in LTR and RTL alike (the popup clamps to safe area).
        popup.open({
            anchor,
            align: 'end',
            sourceKey: `user-menu:${userId}`,
            actions,
            accessibilityLabel: `Actions for ${name}`,
        });
    };

    const handleMessage = async (): Promise<void> => {
        if (messagePending) return;
        setMessagePending(true);
        setMessageError(null);
        try {
            // Reuses an existing chat from the list cache without a request.
            await openPrivateChat(userId, { queryClient });
        } catch (error) {
            setMessageError(
                error instanceof Error
                    ? error.message
                    : 'Could not start this chat.',
            );
        } finally {
            setMessagePending(false);
        }
    };

    return (
        <Screen style={styles.screen} withTopInset={true}>
            <GlassHeader
                leading={
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Go back"
                        style={styles.backButton}
                        onPress={(): void => router.back()}
                    >
                        <Text style={styles.backText}>‹</Text>
                    </Pressable>
                }
                trailing={
                    isSelf ? undefined : (
                        <Pressable
                            ref={menuButtonRef}
                            accessibilityRole="button"
                            accessibilityLabel={`Actions for ${name}`}
                            accessibilityState={{
                                disabled: actionPending,
                                busy: actionPending,
                            }}
                            disabled={actionPending}
                            hitSlop={8}
                            onPress={(): void => {
                                void openMenu();
                            }}
                            style={({ pressed }) => [
                                styles.menuButton,
                                pressed && styles.pressed,
                            ]}
                        >
                            {actionPending ? (
                                <ActivityIndicator
                                    size="small"
                                    color={palette.primary[500]}
                                />
                            ) : (
                                <EllipsisVertical
                                    size={20}
                                    strokeWidth={2}
                                    color={palette.text.primary}
                                />
                            )}
                        </Pressable>
                    )
                }
            >
                <SafeText
                    lines={1}
                    style={[typography.heading, styles.headerTitle]}
                >
                    {name}
                </SafeText>
            </GlassHeader>

            {/* Shared content is the screen's single scroll container; the
                existing profile block above it is passed unchanged as the
                header. Without a conversation there is nothing to list, so
                only the header renders. */}
            <ChatSharedContent
                chatId={
                    chat !== null && chat !== undefined ? Number(chat.id) : null
                }
                header={
                    <View style={styles.scroll}>
                        <GlassCard
                            padding={spacing.lg}
                            contentStyle={styles.hero}
                            floating={true}
                        >
                            {avatars.length > 0 ? (
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel={`View all photos of ${name}`}
                                    onPress={(): void => setViewerIndex(0)}
                                    style={({ pressed }) =>
                                        pressed && styles.pressed
                                    }
                                >
                                    <Avatar
                                        userId={userId}
                                        name={name}
                                        uri={currentAvatarPath}
                                        size={116}
                                        ring={true}
                                    />
                                </Pressable>
                            ) : (
                                <Avatar
                                    userId={userId}
                                    name={name}
                                    uri={currentAvatarPath}
                                    size={116}
                                    ring={true}
                                />
                            )}

                            <SafeText
                                lines={2}
                                style={[typography.title, styles.name]}
                            >
                                {name}
                            </SafeText>
                            {profile?.username !== null &&
                                profile?.username !== undefined && (
                                    <AppText variant="caption">
                                        @{profile.username}
                                    </AppText>
                                )}
                            {presence !== null && (
                                <AppText variant="caption">{presence}</AppText>
                            )}
                            {/* The numeric id stays internal (params, API, keys); it
                        is only surfaced on the viewer's own profile. */}
                            {isSelf && (
                                <AppText
                                    variant="caption"
                                    style={styles.userId}
                                >
                                    User ID: {userId}
                                </AppText>
                            )}
                            {!isSelf && (
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel={`Message ${name}`}
                                    accessibilityState={{
                                        disabled: messagePending,
                                    }}
                                    disabled={messagePending}
                                    onPress={(): void => {
                                        void handleMessage();
                                    }}
                                    style={({ pressed }) => [
                                        styles.messageButton,
                                        pressed && styles.pressed,
                                        messagePending &&
                                            styles.messageButtonBusy,
                                    ]}
                                >
                                    {messagePending ? (
                                        <ActivityIndicator
                                            size="small"
                                            color={palette.text.onAccent}
                                        />
                                    ) : (
                                        <Text style={styles.messageButtonText}>
                                            Message
                                        </Text>
                                    )}
                                </Pressable>
                            )}
                            {messageError !== null && (
                                <AppText style={styles.errorText}>
                                    {messageError}
                                </AppText>
                            )}
                        </GlassCard>

                        {query.isLoading && (
                            <View style={styles.center}>
                                <ActivityIndicator
                                    size="small"
                                    color={palette.primary[500]}
                                />
                            </View>
                        )}

                        {query.error !== null && (
                            <View style={styles.errorBlock}>
                                <AppText style={styles.errorText}>
                                    {describePublicProfileError(query.error)}
                                </AppText>
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel="Retry loading this profile"
                                    onPress={query.refetch}
                                    style={({ pressed }) => [
                                        styles.retryButton,
                                        pressed && styles.pressed,
                                    ]}
                                >
                                    <Text style={styles.retryText}>Retry</Text>
                                </Pressable>
                            </View>
                        )}

                        {bio !== undefined && bio !== '' && (
                            <View style={styles.section}>
                                <AppText
                                    variant="caption"
                                    style={styles.sectionLabel}
                                >
                                    Bio
                                </AppText>
                                <SafeText lines={0} style={styles.bio}>
                                    {bio}
                                </SafeText>
                            </View>
                        )}
                    </View>
                }
            />

            <AvatarViewer
                readOnly={true}
                visible={viewerIndex !== null}
                avatars={avatars}
                initialIndex={viewerIndex ?? 0}
                onClose={(): void => setViewerIndex(null)}
            />
        </Screen>
    );
}

function UnavailableProfile({
    userId,
}: {
    userId: number;
}): React.ReactElement {
    return (
        <Screen style={styles.screen} withTopInset={true}>
            <GlassHeader
                leading={
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Go back"
                        style={styles.backButton}
                        onPress={(): void => router.back()}
                    >
                        <Text style={styles.backText}>‹</Text>
                    </Pressable>
                }
            >
                <Text
                    style={[typography.heading, styles.headerTitle]}
                    numberOfLines={1}
                >
                    Profile
                </Text>
            </GlassHeader>
            <View style={styles.center}>
                <GlassCard
                    padding={spacing.lg}
                    contentStyle={styles.hero}
                    floating={true}
                >
                    <Avatar
                        userId={userId}
                        name="؟"
                        uri={null}
                        size={96}
                        ring={true}
                    />
                    <Text style={[typography.title, styles.name]}>
                        Profile isn&apos;t available
                    </Text>
                    <AppText variant="caption" style={styles.errorText}>
                        This profile can no longer be shown.
                    </AppText>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Back"
                        onPress={(): void => {
                            if (router.canGoBack()) {
                                router.back();
                                return;
                            }
                            router.replace('/(app)');
                        }}
                        style={({ pressed }) => [
                            styles.retryButton,
                            pressed && styles.pressed,
                        ]}
                    >
                        <Text style={styles.retryText}>Back</Text>
                    </Pressable>
                </GlassCard>
            </View>
        </Screen>
    );
}

function InvalidUser(): React.ReactElement {
    return (
        <Screen style={styles.center} withTopInset={true}>
            <AppText variant="title">Invalid user</AppText>
            <AppText variant="caption" style={styles.errorText}>
                This user link is not valid.
            </AppText>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel="Back to chats"
                onPress={(): void => {
                    if (router.canGoBack()) {
                        router.back();
                        return;
                    }
                    router.replace('/(app)');
                }}
                style={styles.retryButton}
            >
                <Text style={styles.retryText}>Back</Text>
            </Pressable>
        </Screen>
    );
}

const styles = StyleSheet.create({
    screen: { paddingHorizontal: spacing.md },
    backButton: {
        width: 40,
        height: 40,
        alignItems: 'center',
        justifyContent: 'center',
    },
    backText: { color: palette.primary[600], fontSize: 26, fontWeight: '700' },
    headerTitle: { textAlign: 'center' },
    menuButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
    },
    scroll: { paddingVertical: spacing.sm, gap: spacing.md },
    hero: { alignItems: 'center', gap: spacing.xxs },
    name: {
        alignSelf: 'stretch',
        textAlign: 'center',
        marginTop: spacing.xs,
    },
    userId: { color: palette.text.muted },
    center: { alignItems: 'center', justifyContent: 'center', flex: 1 },
    pressed: { opacity: 0.6 },
    errorBlock: { alignItems: 'center', gap: spacing.xs },
    errorText: { color: palette.text.secondary, textAlign: 'center' },
    retryButton: {
        borderWidth: 1,
        borderColor: palette.primary[500],
        borderRadius: radii.sm,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.xs,
    },
    retryText: {
        color: palette.primary[600],
        fontSize: 14,
        fontWeight: '600',
    },
    messageButton: {
        marginTop: spacing.xs,
        minWidth: 128,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: palette.primary[500],
        borderRadius: radii.lg,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.xs,
    },
    messageButtonBusy: { opacity: 0.6 },
    messageButtonText: {
        color: palette.text.onAccent,
        fontSize: 15,
        fontWeight: '700',
    },
    section: { gap: spacing.xxs },
    sectionLabel: { color: palette.text.muted },
    bio: { color: palette.text.primary, fontSize: 15, lineHeight: 21 },
});
