import { useState } from 'react';
import {
    ActivityIndicator,
    Linking,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { Copy } from 'lucide-react-native';
import {
    AppText,
    Avatar,
    GlassCard,
    GlassHeader,
    OfflineCaption,
    SafeText,
    Screen,
    palette,
    radii,
    spacing,
    typography,
} from '../../../shared/components';
import { useTabBarInset } from '../../../shared/tab-bar';
import { dialog, toast } from '../../../shared/dialog';
import {
    describeAvatarError,
    MAX_AVATARS,
    MAX_AVATAR_BYTES,
    normalizeAvatarMime,
    useDeleteMyAvatar,
    useProfile,
    useSetMainAvatar,
    useUploadMyAvatar,
} from '../../../features/users';
import {
    AvatarActionSheet,
    AvatarGallery,
    AvatarViewer,
} from '../../../features/users/avatar-gallery';
import type { AvatarUploadAsset } from '../../../features/users';
import { useTheme, useThemedStyles } from '../../../shared/theme';
import type { AppTheme } from '../../../shared/theme';

/**
 * Profile screen (GET /auth/getme).
 *
 * Backend-backed fields only (docs/mobile-api/users.md): name, username,
 * biografy, phone, avatars. There is NO email, NO separate first/last name and
 * presence (`isOnline`/`lastSeen`) is broken server-side — none of those are
 * shown.
 *
 * Avatar flow (multi-avatar): `avatars[0]` is the current photo everywhere.
 * The gallery lists every photo; "+" uploads a new one (prepended as current),
 * tapping a thumbnail opens the viewer, long-pressing opens the same actions as
 * a sheet, and delete/set-current always reference the stored file NAME.
 */

const MAX_AVATAR_LABEL = `${Math.round(MAX_AVATAR_BYTES / (1024 * 1024))} MB`;

export default function ProfileScreen(): React.ReactElement {
    const theme = useTheme();
    const styles = useThemedStyles(createStyles);
    const profile = useProfile();
    const tabBarInset = useTabBarInset();
    const uploadAvatar = useUploadMyAvatar();
    const deleteAvatar = useDeleteMyAvatar();
    const setMainAvatar = useSetMainAvatar();
    const [viewerIndex, setViewerIndex] = useState<number | null>(null);
    const [sheetIndex, setSheetIndex] = useState<number | null>(null);
    const [feedback, setFeedback] = useState<{
        kind: 'ok' | 'error';
        text: string;
    } | null>(null);

    const { profile: user, avatars, currentAvatarUrl } = profile.view;
    const busy =
        uploadAvatar.isPending ||
        deleteAvatar.isPending ||
        setMainAvatar.isPending;
    const pendingFileName = deleteAvatar.isPending
        ? (deleteAvatar.variables ?? null)
        : setMainAvatar.isPending
          ? (setMainAvatar.variables ?? null)
          : null;

    // Cached profile data wins over a pending/failed refetch.
    if (profile.isLoading && user === null) {
        return (
            <Screen style={styles.center}>
                <ActivityIndicator size="large" color={theme.accent} />
            </Screen>
        );
    }
    if (user === null) {
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

    const displayName = user.name;
    const sheetAvatar =
        sheetIndex === null ? null : (avatars[sheetIndex] ?? null);

    const pickAndUpload = async (): Promise<void> => {
        if (busy) {
            return;
        }
        if (avatars.length >= MAX_AVATARS) {
            setFeedback({
                kind: 'error',
                text: `You can keep up to ${MAX_AVATARS} photos. Delete one first.`,
            });
            return;
        }

        // Photo-library permission (native only; the web picker has none).
        if (Platform.OS !== 'web') {
            const permission =
                await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (!permission.granted) {
                dialog.show({
                    title: 'Photo access needed',
                    message:
                        'Allow photo access to add a profile photo. You can change this later in Settings.',
                    tone: 'warning',
                    buttons: [
                        { text: 'Not now', style: 'cancel' },
                        {
                            text: 'Open settings',
                            onPress: (): void => {
                                void Linking.openSettings();
                            },
                        },
                    ],
                });
                return;
            }
        }

        setFeedback(null);
        let result: ImagePicker.ImagePickerResult;
        try {
            result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ['images'],
                allowsEditing: true,
                aspect: [1, 1],
                quality: 0.8,
            });
        } catch {
            setFeedback({
                kind: 'error',
                text: 'Could not open the photo library.',
            });
            return;
        }
        // Cancellation is a normal outcome, not an error.
        if (result.canceled) {
            return;
        }
        const asset = result.assets[0];
        if (asset?.uri === undefined || asset.uri === '') {
            setFeedback({
                kind: 'error',
                text: 'Could not read the selected image.',
            });
            return;
        }

        const mimeType = normalizeAvatarMime(
            asset.mimeType ?? null,
            asset.fileName ?? null,
        );
        if (mimeType === null) {
            setFeedback({
                kind: 'error',
                text: 'Pick a JPEG, PNG or WebP image.',
            });
            return;
        }
        if (asset.fileSize !== undefined && asset.fileSize > MAX_AVATAR_BYTES) {
            setFeedback({
                kind: 'error',
                text: `That image is larger than ${MAX_AVATAR_LABEL}. Pick a smaller photo.`,
            });
            return;
        }

        const payload: AvatarUploadAsset = {
            uri: asset.uri,
            mimeType,
            fileName: asset.fileName ?? null,
        };
        try {
            // Resolves only once the backend stored the file and the profile
            // cache was refreshed from the response.
            await uploadAvatar.mutateAsync(payload);
            setFeedback({ kind: 'ok', text: 'Photo added.' });
        } catch (error) {
            setFeedback({
                kind: 'error',
                text: describeAvatarError(error),
            });
        }
    };

    const performSetMain = async (fileName: string): Promise<boolean> => {
        if (setMainAvatar.isPending) {
            return false;
        }
        setFeedback(null);
        try {
            await setMainAvatar.mutateAsync(fileName);
            setFeedback({ kind: 'ok', text: 'Profile photo updated.' });
            return true;
        } catch (error) {
            const text = describeAvatarError(error);
            setFeedback({ kind: 'error', text });
            dialog.show({
                title: 'Could not update the photo',
                message: text,
                tone: 'danger',
                buttons: [
                    { text: 'Cancel', style: 'cancel' },
                    {
                        text: 'Retry',
                        onPress: (): void => {
                            void performSetMain(fileName);
                        },
                    },
                ],
            });
            return false;
        }
    };

    const performDelete = async (fileName: string): Promise<void> => {
        if (deleteAvatar.isPending) {
            return;
        }
        setFeedback(null);
        try {
            await deleteAvatar.mutateAsync(fileName);
            setFeedback({ kind: 'ok', text: 'Photo deleted.' });
        } catch (error) {
            const text = describeAvatarError(error);
            setFeedback({ kind: 'error', text });
            dialog.show({
                title: 'Could not delete the photo',
                message: text,
                tone: 'danger',
                buttons: [
                    { text: 'Cancel', style: 'cancel' },
                    {
                        text: 'Retry',
                        onPress: (): void => {
                            void performDelete(fileName);
                        },
                    },
                ],
            });
        }
    };

    const confirmDeleteFromSheet = (fileName: string): void => {
        void dialog
            .confirm({
                title: 'Delete this photo?',
                message: 'It will be removed from your profile for everyone.',
                confirmText: 'Delete',
                destructive: true,
            })
            .then((confirmed): void => {
                if (!confirmed) {
                    return;
                }
                setSheetIndex(null);
                void performDelete(fileName);
            });
    };

    // Telegram-style: tap your own @username to copy it.
    const copyUsername = async (): Promise<void> => {
        if (user.username === null) {
            return;
        }
        try {
            // Light haptic feedback; unsupported on some targets.
            try {
                void Haptics.selectionAsync();
            } catch {
                // Ignore unsupported haptics targets.
            }
            await Clipboard.setStringAsync(user.username);
            toast.show('Username copied', { tone: 'success' });
        } catch {
            toast.show('Could not copy username', { tone: 'danger' });
        }
    };

    return (
        <Screen style={styles.screen} withTopInset={true}>
            <ScrollView
                contentContainerStyle={[
                    styles.scroll,
                    { paddingBottom: tabBarInset },
                ]}
                keyboardShouldPersistTaps="handled"
            >
                <GlassHeader
                    trailing={
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Edit profile"
                            onPress={(): void =>
                                router.push('/(app)/profile-edit')
                            }
                            style={styles.editPill}
                        >
                            <AppText style={styles.editPillText}>Edit</AppText>
                        </Pressable>
                    }
                >
                    <AppText variant="heading">Profile</AppText>
                    <AppText variant="caption">
                        {user.username === null
                            ? 'Your account'
                            : `@${user.username}`}
                    </AppText>
                </GlassHeader>

                <OfflineCaption />

                <GlassCard
                    padding={spacing.lg}
                    contentStyle={styles.avatarSection}
                    floating={true}
                >
                    {/* Small circle → server thumbnail; the full original is
                        only loaded by the photo viewer below. */}
                    <Avatar
                        userId={user.id}
                        name={displayName}
                        uri={currentAvatarUrl}
                        size={116}
                        ring={true}
                    />

                    <AvatarGallery
                        avatars={avatars}
                        maxAvatars={MAX_AVATARS}
                        uploading={uploadAvatar.isPending}
                        pendingFileName={pendingFileName}
                        disabled={busy}
                        onPressAvatar={(index): void => setViewerIndex(index)}
                        onLongPressAvatar={(index): void =>
                            setSheetIndex(index)
                        }
                        onPressAdd={(): void => {
                            void pickAndUpload();
                        }}
                    />

                    <AppText variant="caption" style={styles.avatarHint}>
                        {avatars.length === 0
                            ? 'Add up to 10 profile photos.'
                            : `Tap a photo to view it. ${avatars.length}/${MAX_AVATARS} used.`}
                    </AppText>

                    {feedback !== null && (
                        <AppText
                            style={[
                                theme.type.caption,
                                feedback.kind === 'error'
                                    ? styles.errorText
                                    : styles.okText,
                            ]}
                        >
                            {feedback.text}
                        </AppText>
                    )}
                </GlassCard>

                <GlassCard padding={spacing.md} contentStyle={styles.infoCard}>
                    <InfoRow label="Name" value={user.name} />
                    <InfoRow
                        label="Username"
                        value={
                            user.username === null ? '—' : `@${user.username}`
                        }
                        onPress={
                            user.username === null
                                ? undefined
                                : (): void => {
                                      void copyUsername();
                                  }
                        }
                        hint="Tap to copy your username"
                    />
                    <InfoRow
                        label="Bio"
                        value={user.biografy ?? '—'}
                        multiline={true}
                    />
                    <InfoRow label="Phone" value={user.phone} />
                </GlassCard>
            </ScrollView>

            <AvatarViewer
                visible={viewerIndex !== null}
                avatars={avatars}
                initialIndex={viewerIndex ?? 0}
                busy={busy}
                pendingFileName={pendingFileName}
                onClose={(): void => setViewerIndex(null)}
                onSetMain={performSetMain}
                onDelete={performDelete}
            />

            <AvatarActionSheet
                avatar={sheetAvatar}
                isCurrent={sheetIndex === 0}
                busy={busy}
                onSetMain={(): void => {
                    const target = sheetAvatar;
                    setSheetIndex(null);
                    if (target !== null) {
                        void performSetMain(target.fileName);
                    }
                }}
                onDelete={(): void => {
                    if (sheetAvatar !== null) {
                        confirmDeleteFromSheet(sheetAvatar.fileName);
                    }
                }}
                onDismiss={(): void => setSheetIndex(null)}
            />
        </Screen>
    );
}

function InfoRow(props: {
    label: string;
    value: string;
    multiline?: boolean;
    onPress?: (() => void) | undefined;
    hint?: string;
}): React.ReactElement {
    const theme = useTheme();
    const styles = useThemedStyles(createStyles);
    const multiline = props.multiline !== undefined && props.multiline;
    const value = (
        <View style={styles.infoValueRow}>
            <SafeText
                lines={multiline ? 0 : 1}
                style={[
                    styles.infoValue,
                    multiline && styles.infoMultiline,
                    props.onPress !== undefined && styles.infoValueTappable,
                ]}
            >
                {props.value}
            </SafeText>
            {props.onPress !== undefined && (
                <Copy
                    size={14}
                    color={theme.colors.textMuted}
                    accessibilityElementsHidden={true}
                    importantForAccessibility="no-hide-descendants"
                />
            )}
        </View>
    );

    if (props.onPress === undefined) {
        return (
            <View style={styles.infoRow}>
                <AppText variant="caption" style={styles.infoLabel}>
                    {props.label}
                </AppText>
                {value}
            </View>
        );
    }

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${props.label}: ${props.value}`}
            accessibilityHint={props.hint}
            onPress={props.onPress}
            style={({ pressed }) => [
                styles.infoRow,
                pressed && styles.infoRowPressed,
            ]}
        >
            <AppText variant="caption" style={styles.infoLabel}>
                {props.label}
            </AppText>
            {value}
        </Pressable>
    );
}

function FormRow(props: {
    label: string;
    onPress: () => void;
}): React.ReactElement {
    const theme = useTheme();
    const styles = useThemedStyles(createStyles);
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={props.label}
            onPress={props.onPress}
            style={styles.button}
        >
            <AppText style={styles.buttonText}>{props.label}</AppText>
        </Pressable>
    );
}

const createStyles = (theme: AppTheme) =>
    StyleSheet.create({
    screen: { gap: spacing.sm, paddingHorizontal: spacing.lg },
    scroll: { paddingVertical: spacing.sm, gap: spacing.xs },
    center: { alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
    editPill: {
        borderWidth: 1,
        borderColor: theme.colors.borderStrong,
        borderRadius: radii.full,
        paddingHorizontal: spacing.sm,
        paddingVertical: 6,
        backgroundColor: theme.colors.glassAccent,
    },
    editPillText: {
        color: theme.accent,
        fontSize: 13,
        fontWeight: '600',
    },
    avatarSection: {
        alignItems: 'center',
        gap: spacing.sm,
    },
    infoCard: { gap: 0 },
    avatar: { width: 120, height: 120, borderRadius: 60 },
    avatarFallback: {
        width: 120,
        height: 120,
        borderRadius: 60,
        backgroundColor: theme.colors.accentSoft,
        alignItems: 'center',
        justifyContent: 'center',
    },
    avatarFallbackText: {
        color: theme.accent,
        fontSize: 42,
        fontWeight: '700',
    },
    avatarHint: { color: theme.colors.textSecondary },
    button: {
        backgroundColor: theme.accent,
        borderRadius: radii.full,
        paddingHorizontal: spacing.md,
        paddingVertical: 8,
    },
    buttonText: {
        color: theme.colors.accentText,
        fontSize: 13,
        fontWeight: '600',
    },
    errorText: { color: theme.colors.danger },
    okText: { color: theme.colors.success },
    infoRow: {
        gap: spacing.xxs,
        paddingVertical: spacing.sm,
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
    },
    infoRowPressed: { backgroundColor: theme.colors.glassAccent },
    infoLabel: { color: theme.colors.textMuted },
    infoValueRow: {
        flex: 1,
        minWidth: 0,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xxs,
    },
    infoValue: {
        flexShrink: 1,
        minWidth: 0,
        color: theme.colors.text,
        fontSize: 15,
    },
    infoValueTappable: { color: theme.accent },
    infoMultiline: { minHeight: 40 },
    feedback: {
        color: theme.colors.textSecondary,
        textAlign: 'center',
        paddingHorizontal: spacing.lg,
    },
});
