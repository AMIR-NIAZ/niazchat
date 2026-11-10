import { useState } from 'react';
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
    Screen,
    UserAvatar,
    palette,
    radii,
    spacing,
    typography,
} from '../../../shared/components';
import {
    AvatarGallery,
    AvatarViewer,
} from '../../../features/users/avatar-gallery';
import { presenceLabel } from '../../../features/users/public-profile-model';
import { useRegisterOpenUserProfile } from '../../../features/users/profile-navigation';
import { useUserProfile } from '../../../features/users/use-user-profile';
import { describePublicProfileError } from '../../../features/users/users-service';
import { useCurrentUserId } from '../../../features/auth';
import { openPrivateChat } from '../../../features/chats';

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

    const profile = query.profile;
    const name = profile?.name ?? initialName ?? 'Profile';
    const avatars = profile?.avatars ?? [];
    const currentAvatarPath = avatars[0]?.storedPath ?? initialAvatar;
    const presence = profile === null ? null : presenceLabel(profile);
    const bio = profile?.biografy?.trim();

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
            <View style={styles.header}>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Go back"
                    style={styles.backButton}
                    onPress={(): void => router.back()}
                >
                    <Text style={styles.backText}>‹</Text>
                </Pressable>
                <Text
                    style={[typography.title, styles.headerTitle]}
                    numberOfLines={1}
                >
                </Text>
                {/* Balances the back button so the title stays centered. */}
                <View style={styles.backButton} />
            </View>

            <ScrollView
                contentContainerStyle={styles.scroll}
                keyboardShouldPersistTaps="handled"
            >
                <View style={styles.hero}>
                    {avatars.length > 0 ? (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`View all photos of ${name}`}
                            onPress={(): void => setViewerIndex(0)}
                            style={({ pressed }) => pressed && styles.pressed}
                        >
                            <UserAvatar
                                userId={userId}
                                name={name}
                                uri={currentAvatarPath}
                                size={128}
                            />
                        </Pressable>
                    ) : (
                        <UserAvatar
                            userId={userId}
                            name={name}
                            uri={currentAvatarPath}
                            size={128}
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
                                    color={palette.neutral[0]}
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
                </View>

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
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
    },
    backButton: {
        width: 40,
        height: 40,
        alignItems: 'center',
        justifyContent: 'center',
    },
    backText: { color: palette.primary[600], fontSize: 26, fontWeight: '700' },
    headerTitle: { flex: 1, textAlign: 'center' },
    scroll: { paddingVertical: spacing.sm, gap: spacing.md },
    hero: { alignItems: 'center', gap: spacing.xxs },
    name: { marginTop: spacing.xs },
    center: { alignItems: 'center', justifyContent: 'center', flex: 1 },
    pressed: { opacity: 0.6 },
    errorBlock: { alignItems: 'center', gap: spacing.xs },
    errorText: { color: palette.neutral[700], textAlign: 'center' },
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
        color: palette.neutral[0],
        fontSize: 15,
        fontWeight: '700',
    },
    section: { gap: spacing.xxs },
    sectionLabel: { color: palette.neutral[500] },
    bio: { color: palette.neutral[900], fontSize: 15, lineHeight: 21 },
});
