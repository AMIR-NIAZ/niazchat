import { useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import {
    AppText,
    Avatar,
    GlassCard,
    GlassHeader,
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
import { openPrivateChat } from '../../../features/chats';
import { dialog, toast } from '../../../shared/dialog';
import { ApiError } from '../../../core/api';
import {
    useAddContact,
    useContacts,
    useRemoveContact,
} from '../../../features/contacts/use-contacts';
import { describeSavedContactError } from '../../../features/contacts/contacts-api';

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
    const [contactPending, setContactPending] = useState(false);
    const [contactError, setContactError] = useState<string | null>(null);
    /** Blocks a second add/remove while one (including its confirm) is open. */
    const contactBusyRef = useRef(false);

    const profile = query.profile;
    const unavailable =
        query.error instanceof ApiError && query.error.statusCode === 404;
    const hiddenHandled = useRef(false);

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

    const handleAddContact = async (): Promise<void> => {
        if (contactBusyRef.current) return;
        contactBusyRef.current = true;
        setContactPending(true);
        setContactError(null);
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
                // The contact already exists server-side: refresh so the hero
                // switches to "Remove from contacts" instead of allowing a
                // second create.
                savedContacts.refetch();
                toast.show('Already in your contacts');
            } else {
                setContactError(describeSavedContactError(error));
            }
        } finally {
            contactBusyRef.current = false;
            setContactPending(false);
        }
    };

    const handleRemoveContact = async (): Promise<void> => {
        if (contactBusyRef.current || savedContact === undefined) return;
        contactBusyRef.current = true;
        try {
            const confirmed = await dialog.confirm({
                title: `Remove ${name} from contacts?`,
                message:
                    'They will be removed from your saved contacts. This does not affect your chat.',
                confirmText: 'Remove',
                destructive: true,
            });
            if (!confirmed) return;
            setContactPending(true);
            setContactError(null);
            // A still-optimistic row has no server id yet; wait for the list
            // instead of sending a delete for a local placeholder id.
            if (savedContact.id <= 0) {
                savedContacts.refetch();
                return;
            }
            await removeContact.mutateAsync(savedContact.id);
            toast.show('Removed from contacts', { tone: 'success' });
        } catch (error) {
            if (error instanceof ApiError && error.statusCode === 404) {
                savedContacts.refetch();
            }
            setContactError(describeSavedContactError(error));
        } finally {
            contactBusyRef.current = false;
            setContactPending(false);
        }
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
            >
                <Text
                    style={[typography.heading, styles.headerTitle]}
                    numberOfLines={1}
                >
                    {name}
                </Text>
            </GlassHeader>

            <ScrollView
                contentContainerStyle={styles.scroll}
                keyboardShouldPersistTaps="handled"
            >
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
                            style={({ pressed }) => pressed && styles.pressed}
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

                    <Text style={[typography.title, styles.name]}>{name}</Text>
                    {profile?.username !== null &&
                        profile?.username !== undefined && (
                            <AppText variant="caption">
                                @{profile.username}
                            </AppText>
                        )}
                    {presence !== null && (
                        <AppText variant="caption">{presence}</AppText>
                    )}
                    <AppText variant="caption" style={styles.userId}>
                        User ID: {userId}
                    </AppText>
                    {!isSelf && (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Message ${name}`}
                            accessibilityState={{ disabled: messagePending }}
                            disabled={messagePending}
                            onPress={(): void => {
                                void handleMessage();
                            }}
                            style={({ pressed }) => [
                                styles.messageButton,
                                pressed && styles.pressed,
                                messagePending && styles.messageButtonBusy,
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
                    {!isSelf &&
                        (isSavedContact ? (
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={`Remove ${name} from contacts`}
                                accessibilityState={{
                                    disabled: contactPending,
                                    busy: contactPending,
                                }}
                                disabled={contactPending}
                                onPress={(): void => {
                                    void handleRemoveContact();
                                }}
                                style={({ pressed }) => [
                                    styles.contactButton,
                                    pressed && styles.pressed,
                                    contactPending && styles.messageButtonBusy,
                                ]}
                            >
                                {contactPending ? (
                                    <ActivityIndicator
                                        size="small"
                                        color={palette.primary[600]}
                                    />
                                ) : (
                                    <Text style={styles.contactButtonText}>
                                        Remove from contacts
                                    </Text>
                                )}
                            </Pressable>
                        ) : (
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={`Add ${name} to contacts`}
                                accessibilityState={{
                                    disabled: contactPending,
                                    busy: contactPending,
                                }}
                                disabled={contactPending}
                                onPress={(): void => {
                                    void handleAddContact();
                                }}
                                style={({ pressed }) => [
                                    styles.contactButton,
                                    pressed && styles.pressed,
                                    contactPending && styles.messageButtonBusy,
                                ]}
                            >
                                {contactPending ? (
                                    <ActivityIndicator
                                        size="small"
                                        color={palette.primary[600]}
                                    />
                                ) : (
                                    <Text style={styles.contactButtonText}>
                                        ＋ Add to contacts
                                    </Text>
                                )}
                            </Pressable>
                        ))}
                    {contactError !== null && (
                        <AppText style={styles.errorText}>
                            {contactError}
                        </AppText>
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
                        <AppText variant="caption" style={styles.sectionLabel}>
                            Bio
                        </AppText>
                        <Text style={styles.bio}>{bio}</Text>
                    </View>
                )}
            </ScrollView>

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
    scroll: { paddingVertical: spacing.sm, gap: spacing.md },
    hero: { alignItems: 'center', gap: spacing.xxs },
    name: { marginTop: spacing.xs },
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
    contactButton: {
        marginTop: spacing.xxs,
        minWidth: 128,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radii.lg,
        borderWidth: 1,
        borderColor: palette.border.accent,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.xs,
        backgroundColor: palette.glass.accent,
    },
    contactButtonText: {
        color: palette.primary[600],
        fontSize: 14,
        fontWeight: '700',
    },
    section: { gap: spacing.xxs },
    sectionLabel: { color: palette.text.muted },
    bio: { color: palette.text.primary, fontSize: 15, lineHeight: 21 },
});
