import { useState } from 'react';
import {
    ActivityIndicator,
    Image,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import {
    AppText,
    Screen,
    palette,
    radii,
    spacing,
    typography,
} from '../../shared/components';
import {
    describeProfileError,
    useDeleteMyAvatar,
    useProfile,
    useUploadMyAvatar,
} from '../../features/users';

/**
 * Profile screen (GET /auth/getme).
 *
 * Backend-backed fields only (docs/mobile-api/users.md): name, username,
 * biografy, phone, avatars. There is NO email, NO separate first/last name and
 * presence (`isOnline`/`lastSeen`) is broken server-side — none of those are
 * shown.
 *
 * Avatar flow: `PUT /user/uploade-avatar` APPENDS to `profile.avatars`, so a
 * replace is modeled as pick → preview → confirm upload → (backend keeps
 * history; the LAST avatar is displayed) + optional "Remove photo" which calls
 * `DELETE /user/delete-avatar` with the exact stored path.
 */

export default function ProfileScreen(): React.ReactElement {
    const profile = useProfile();
    const uploadAvatar = useUploadMyAvatar();
    const deleteAvatar = useDeleteMyAvatar();
    const [pickedUri, setPickedUri] = useState<string | null>(null);
    const [feedback, setFeedback] = useState<{
        kind: 'ok' | 'error';
        text: string;
    } | null>(null);

    const {
        profile: user,
        avatarUrls: avatarUrlList,
        currentAvatarPath,
    } = profile.view;

    if (profile.isLoading) {
        return (
            <Screen style={styles.center}>
                <ActivityIndicator size="large" color={palette.primary[500]} />
            </Screen>
        );
    }
    if (profile.error !== null || user === null) {
        return (
            <Screen style={styles.center}>
                <AppText variant="title">Could not load your profile</AppText>
                <AppText variant="caption" style={styles.feedback}>
                    {profile.error?.message ?? 'No profile data.'}
                </AppText>
                <FormRow
                    label="Retry"
                    onPress={(): void => profile.refetch()}
                />
                <FormRow label="Back" onPress={(): void => router.back()} />
            </Screen>
        );
    }

    const latestAvatarUrl =
        avatarUrlList.length > 0
            ? (avatarUrlList[avatarUrlList.length - 1] ?? null)
            : null;
    const displayName = user.name;
    const displayInitial =
        displayName.length > 0 ? displayName.slice(0, 1) : '?';

    const pickAvatarImage = async (): Promise<void> => {
        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            allowsEditing: true,
            aspect: [1, 1],
            quality: 0.8,
        });
        if (result.canceled || result.assets[0]?.uri === undefined) {
            return;
        }
        setPickedUri(result.assets[0].uri);
    };

    const confirmUpload = async (): Promise<void> => {
        if (pickedUri === null) {
            return;
        }
        setFeedback(null);
        try {
            await uploadAvatar.mutateAsync(pickedUri);
            setPickedUri(null);
            setFeedback({ kind: 'ok', text: 'Avatar updated.' });
        } catch (error) {
            setFeedback({ kind: 'error', text: describeProfileError(error) });
        }
    };

    const removeAvatar = async (): Promise<void> => {
        if (currentAvatarPath === null) {
            return;
        }
        setFeedback(null);
        try {
            await deleteAvatar.mutateAsync(currentAvatarPath);
            setFeedback({ kind: 'ok', text: 'Avatar removed.' });
        } catch (error) {
            setFeedback({ kind: 'error', text: describeProfileError(error) });
        }
    };

    return (
        <Screen style={styles.screen} withTopInset={true}>
            <ScrollView
                contentContainerStyle={styles.scroll}
                keyboardShouldPersistTaps="handled"
            >
                <View style={styles.header}>
                    <AppText variant="title">Profile</AppText>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Edit profile"
                        onPress={(): void => router.push('/(app)/profile-edit')}
                        style={styles.editPill}
                    >
                        <Text style={styles.editPillText}>Edit</Text>
                    </Pressable>
                </View>

                <View style={styles.avatarSection}>
                    {pickedUri === null ? (
                        latestAvatarUrl === null ? (
                            <View style={styles.avatarFallback}>
                                <Text style={styles.avatarFallbackText}>
                                    {displayInitial}
                                </Text>
                            </View>
                        ) : (
                            <Image
                                accessibilityLabel="Profile photo"
                                style={styles.avatar}
                                source={{ uri: latestAvatarUrl }}
                            />
                        )
                    ) : (
                        <>
                            <Image
                                accessibilityLabel="Selected photo preview"
                                style={styles.avatar}
                                source={{ uri: pickedUri }}
                            />
                            <AppText variant="caption">
                                Preview — confirm to upload
                            </AppText>
                        </>
                    )}

                    <View style={styles.avatarActions}>
                        {pickedUri === null ? (
                            <FormRow
                                label={
                                    uploadAvatar.isPending
                                        ? 'Uploading…'
                                        : latestAvatarUrl === null
                                          ? 'Add photo'
                                          : 'Change photo'
                                }
                                onPress={(): void => {
                                    void pickAvatarImage();
                                }}
                            />
                        ) : (
                            <>
                                <FormRow
                                    label={
                                        uploadAvatar.isPending
                                            ? 'Uploading…'
                                            : 'Confirm upload'
                                    }
                                    onPress={(): void => {
                                        void confirmUpload();
                                    }}
                                />
                                <FormRow
                                    intent="ghost"
                                    label="Discard"
                                    onPress={(): void => setPickedUri(null)}
                                />
                            </>
                        )}
                        {pickedUri === null && currentAvatarPath !== null && (
                            <FormRow
                                intent="danger"
                                label={
                                    deleteAvatar.isPending
                                        ? 'Removing…'
                                        : 'Remove photo'
                                }
                                onPress={(): void => {
                                    void removeAvatar();
                                }}
                            />
                        )}
                    </View>

                    {feedback !== null && (
                        <Text
                            style={[
                                typography.caption,
                                feedback.kind === 'error'
                                    ? styles.errorText
                                    : styles.okText,
                            ]}
                        >
                            {feedback.text}
                        </Text>
                    )}
                </View>

                <InfoRow label="Name" value={user.name} />
                <InfoRow
                    label="Username"
                    value={user.username === null ? '—' : `@${user.username}`}
                />
                <InfoRow
                    label="Bio"
                    value={user.biografy ?? '—'}
                    multiline={true}
                />
                <InfoRow label="Phone" value={user.phone} />
            </ScrollView>
        </Screen>
    );
}

function InfoRow(props: {
    label: string;
    value: string;
    multiline?: boolean;
}): React.ReactElement {
    return (
        <View style={styles.infoRow}>
            <AppText variant="caption" style={styles.infoLabel}>
                {props.label}
            </AppText>
            <Text
                style={[
                    styles.infoValue,
                    props.multiline !== undefined &&
                        props.multiline &&
                        styles.infoMultiline,
                ]}
            >
                {props.value}
            </Text>
        </View>
    );
}

function FormRow(props: {
    label: string;
    onPress: () => void;
    intent?: 'primary' | 'ghost' | 'danger';
}): React.ReactElement {
    return (
        <Pressable
            accessibilityRole="button"
            onPress={props.onPress}
            style={[
                styles.button,
                props.intent === 'ghost' && styles.buttonGhost,
                props.intent === 'danger' && styles.buttonDanger,
            ]}
        >
            <Text
                style={[
                    styles.buttonText,
                    props.intent === 'danger' && styles.buttonDangerText,
                    props.intent === 'ghost' && styles.buttonGhostText,
                ]}
            >
                {props.label}
            </Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    screen: { gap: spacing.sm, paddingHorizontal: spacing.lg },
    scroll: { paddingVertical: spacing.sm, gap: spacing.xs },
    center: { alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    editPill: {
        borderWidth: 1,
        borderColor: palette.primary[500],
        borderRadius: radii.sm,
        paddingHorizontal: spacing.sm,
        paddingVertical: 6,
    },
    editPillText: {
        color: palette.primary[600],
        fontSize: 13,
        fontWeight: '600',
    },
    avatarSection: {
        alignItems: 'center',
        gap: spacing.sm,
        paddingVertical: spacing.md,
    },
    avatar: { width: 120, height: 120, borderRadius: 60 },
    avatarFallback: {
        width: 120,
        height: 120,
        borderRadius: 60,
        backgroundColor: palette.primary[100],
        alignItems: 'center',
        justifyContent: 'center',
    },
    avatarFallbackText: {
        color: palette.primary[700],
        fontSize: 42,
        fontWeight: '700',
    },
    avatarActions: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: spacing.xs,
        justifyContent: 'center',
    },
    button: {
        backgroundColor: palette.primary[500],
        borderRadius: radii.sm,
        paddingHorizontal: spacing.sm,
        paddingVertical: 6,
    },
    buttonText: { color: palette.neutral[0], fontSize: 13, fontWeight: '600' },
    buttonGhost: {
        borderWidth: 1,
        borderColor: palette.primary[500],
        backgroundColor: 'transparent',
    },
    buttonGhostText: { color: palette.primary[600] },
    buttonDanger: {
        borderWidth: 1,
        borderColor: palette.semantic.danger,
        backgroundColor: 'transparent',
    },
    buttonDangerText: { color: palette.semantic.danger },
    errorText: { color: palette.semantic.danger },
    okText: { color: palette.semantic.success },
    infoRow: {
        gap: spacing.xxs,
        paddingVertical: spacing.xs,
        borderTopWidth: 1,
        borderTopColor: palette.neutral[100],
    },
    infoLabel: { color: palette.neutral[500] },
    infoValue: { color: palette.neutral[900], fontSize: 15 },
    infoMultiline: { minHeight: 40 },
    feedback: {
        color: palette.neutral[500],
        textAlign: 'center',
        paddingHorizontal: spacing.lg,
    },
});
