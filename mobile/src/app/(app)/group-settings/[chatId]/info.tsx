import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    BackHandler,
    KeyboardAvoidingView,
    Linking,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import {
    AppText,
    FormButton,
    Screen,
    palette,
    radii,
    spacing,
    typography,
} from '../../../../shared/components';
import { ApiError } from '../../../../core/api';
import { useSocketEvent } from '../../../../core/socket';
import { useCurrentUserId } from '../../../../features/auth';
import { purgeChatFromCaches } from '../../../../features/chats';
import {
    MAX_AVATAR_BYTES,
    normalizeAvatarMime,
} from '../../../../features/users';
import {
    AvatarGallery,
    AvatarViewer,
} from '../../../../features/users/avatar-gallery';
import {
    GROUP_DESCRIPTION_MAX_LENGTH,
    GROUP_TITLE_MAX_LENGTH,
    MAX_GROUP_AVATARS,
    canSaveGroupInfo,
    groupDescriptionError,
    groupInfoChanges,
    groupPhotoLimitHint,
    groupTitleError,
    isGroupInfoDirty,
} from '../../../../features/groups/group-model';
import {
    groupAvatarItems,
    useDeleteGroupAvatar,
    useGroupChangedEvents,
    useGroupInfo,
    useGroupRemovedEvent,
    useGroupUpdatedEvents,
    useSetMainGroupAvatar,
    useUpdateGroupInfo,
    useUploadGroupAvatar,
} from '../../../../features/groups/use-group';
import {
    describeGroupAvatarError,
    describeGroupInfoError,
} from '../../../../features/groups/group-errors';

/**
 * "Group info" edit screen (`/group-settings/:chatId/info`).
 *
 * Photo changes are immediate requests; title/description are saved together in
 * one PATCH and only the changed fields are sent. Losing the capability while
 * the screen is open (a `group:changed` for me) refetches the group info and
 * leaves the screen when `canEditInfo` became false.
 */

type GroupInfoRouteParams = { chatId?: string | string[] };

function parseChatId(value: string | string[] | undefined): number | null {
    const raw = Array.isArray(value) ? value[0] : value;
    if (raw === undefined) return null;
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export default function GroupInfoEditScreen(): React.ReactElement {
    const params = useLocalSearchParams<GroupInfoRouteParams>();
    const chatId = parseChatId(params.chatId);

    if (chatId === null) {
        return (
            <Screen style={styles.centered}>
                <AppText variant="title">Group info unavailable</AppText>
                <AppText variant="caption">
                    This group link is not valid.
                </AppText>
                <FormButton
                    label="Go back"
                    onPress={(): void => router.back()}
                />
            </Screen>
        );
    }
    return <GroupInfoEditor chatId={chatId} />;
}

function GroupInfoEditor({ chatId }: { chatId: number }): React.ReactElement {
    const queryClient = useQueryClient();
    const currentUserId = useCurrentUserId();
    const infoQuery = useGroupInfo(chatId);
    const updateInfo = useUpdateGroupInfo(chatId);
    const uploadAvatar = useUploadGroupAvatar(chatId);
    const deleteAvatar = useDeleteGroupAvatar(chatId);
    const setMainAvatar = useSetMainGroupAvatar(chatId);

    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [saveError, setSaveError] = useState<string | null>(null);
    const [photoError, setPhotoError] = useState<string | null>(null);
    const [viewerIndex, setViewerIndex] = useState<number | null>(null);
    const initializedRef = useRef(false);

    useGroupChangedEvents(chatId);
    useGroupUpdatedEvents();

    const handleRemoved = useCallback((): void => {
        purgeChatFromCaches(queryClient, chatId);
        Alert.alert('Removed from group', 'You were removed from this group');
        router.replace('/(app)');
    }, [queryClient, chatId]);
    useGroupRemovedEvent(chatId, handleRemoved);

    const info = infoQuery.data;
    const photoItems = useMemo(
        () => groupAvatarItems(info?.avatars),
        [info?.avatars],
    );
    useEffect((): void => {
        if (initializedRef.current || info === undefined) return;
        initializedRef.current = true;
        setTitle(info.title);
        setDescription(info.description ?? '');
    }, [info]);

    // Permission/role revocations aimed at me: refetch, then leave if the
    // capability is gone. Refetch is read through a ref so the listener is not
    // re-registered on every render.
    const refetchRef = useRef(infoQuery.refetch);
    refetchRef.current = infoQuery.refetch;
    const onGroupChanged = useCallback(
        (payload: {
            chatId: number;
            reason: string;
            userId?: number;
        }): void => {
            if (currentUserId === null) return;
            if (Number(payload.chatId) !== chatId) return;
            if (payload.userId === undefined) return;
            if (Number(payload.userId) !== currentUserId) return;
            if (
                payload.reason !== 'permissions_changed' &&
                payload.reason !== 'role_changed'
            ) {
                return;
            }
            void refetchRef.current().then((result): void => {
                if (
                    result.data !== undefined &&
                    !result.data.capabilities.canEditInfo
                ) {
                    Alert.alert(
                        'Permission changed',
                        "You can no longer edit this group's info.",
                        [
                            {
                                text: 'OK',
                                onPress: (): void => router.back(),
                            },
                        ],
                    );
                }
            });
        },
        [chatId, currentUserId],
    );
    useSocketEvent('group:changed', onGroupChanged);

    const draft = { title, description };
    const dirty = info === undefined ? false : isGroupInfoDirty(draft, info);
    const titleError = groupTitleError(title);
    const descriptionError = groupDescriptionError(description);
    const saving = updateInfo.isPending;
    const photoBusy =
        uploadAvatar.isPending ||
        deleteAvatar.isPending ||
        setMainAvatar.isPending;
    const photoCount = photoItems.length;
    const limitHint = groupPhotoLimitHint(photoCount);

    const handleBack = useCallback((): void => {
        if (!dirty) {
            router.back();
            return;
        }
        Alert.alert('Discard changes?', 'Your changes will not be saved.', [
            { text: 'Keep editing', style: 'cancel' },
            {
                text: 'Discard',
                style: 'destructive',
                onPress: (): void => router.back(),
            },
        ]);
    }, [dirty]);

    useEffect((): (() => void) => {
        const subscription = BackHandler.addEventListener(
            'hardwareBackPress',
            (): boolean => {
                handleBack();
                return true;
            },
        );
        return (): void => subscription.remove();
    }, [handleBack]);

    const handleFatalError = (error: unknown): boolean => {
        if (
            error instanceof ApiError &&
            (error.statusCode === 403 || error.statusCode === 404)
        ) {
            Alert.alert(
                error.statusCode === 403 ? 'Permission changed' : 'Group gone',
                describeGroupInfoError(error),
                [{ text: 'OK', onPress: (): void => router.back() }],
            );
            void queryClient.invalidateQueries({
                queryKey: ['group', chatId],
            });
            return true;
        }
        return false;
    };

    const handleSave = async (): Promise<void> => {
        if (info === undefined) return;
        if (!canSaveGroupInfo(draft, info, saving)) return;
        const changes = groupInfoChanges(draft, info);
        if (changes === null) return;

        setSaveError(null);
        try {
            const result = await updateInfo.mutateAsync(changes);
            setTitle(result.title);
            setDescription(result.description ?? '');
        } catch (error) {
            if (handleFatalError(error)) return;
            setSaveError(describeGroupInfoError(error));
        }
    };

    const pickPhoto = async (): Promise<void> => {
        if (photoBusy) return;
        if (photoCount >= MAX_GROUP_AVATARS) {
            setPhotoError(
                `This group already has ${MAX_GROUP_AVATARS} photos. Delete one before adding another.`,
            );
            return;
        }

        if (Platform.OS !== 'web') {
            const permission =
                await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (!permission.granted) {
                Alert.alert(
                    'Photo access needed',
                    'Allow photo access to change the group photo. You can change this later in Settings.',
                    [
                        { text: 'Not now', style: 'cancel' },
                        {
                            text: 'Open settings',
                            onPress: (): void => {
                                void Linking.openSettings();
                            },
                        },
                    ],
                );
                return;
            }
        }

        setPhotoError(null);
        let result: ImagePicker.ImagePickerResult;
        try {
            result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ['images'],
                allowsEditing: true,
                aspect: [1, 1],
                quality: 0.8,
            });
        } catch {
            setPhotoError('Could not open the photo library.');
            return;
        }
        if (result.canceled) return;

        const asset = result.assets[0];
        if (asset?.uri === undefined || asset.uri === '') {
            setPhotoError('Could not read the selected image.');
            return;
        }
        const mimeType = normalizeAvatarMime(
            asset.mimeType ?? null,
            asset.fileName ?? null,
        );
        if (mimeType === null) {
            setPhotoError('Pick a JPEG, PNG or WebP image.');
            return;
        }
        if (asset.fileSize !== undefined && asset.fileSize > MAX_AVATAR_BYTES) {
            setPhotoError(
                'That image is larger than 5 MB. Pick a smaller photo.',
            );
            return;
        }

        try {
            await uploadAvatar.mutateAsync({
                uri: asset.uri,
                mimeType,
                fileName: asset.fileName ?? null,
            });
        } catch (error) {
            if (handleFatalError(error)) return;
            setPhotoError(describeGroupAvatarError(error));
        }
    };

    const handleDeletePhoto = async (fileName: string): Promise<void> => {
        try {
            await deleteAvatar.mutateAsync(fileName);
            setPhotoError(null);
        } catch (error) {
            if (handleFatalError(error)) return;
            setPhotoError(describeGroupAvatarError(error));
        }
    };

    const handleSetMainPhoto = async (fileName: string): Promise<boolean> => {
        try {
            const result = await setMainAvatar.mutateAsync(fileName);
            return result.changed;
        } catch (error) {
            if (handleFatalError(error)) return false;
            setPhotoError(describeGroupAvatarError(error));
            return false;
        }
    };

    if (infoQuery.isPending) {
        return (
            <View style={styles.root}>
                <EditorTopBar onBack={handleBack} />
                <View style={styles.centered}>
                    <ActivityIndicator
                        size="large"
                        color={palette.primary[500]}
                    />
                    <AppText variant="caption">Loading group info…</AppText>
                </View>
            </View>
        );
    }

    if (infoQuery.isError || info === undefined) {
        const error = infoQuery.error;
        const privateChat =
            error instanceof ApiError && error.statusCode === 400;
        return (
            <View style={styles.root}>
                <EditorTopBar onBack={(): void => router.back()} />
                <View style={styles.centered}>
                    <AppText variant="title">Group info unavailable</AppText>
                    <AppText variant="caption" style={styles.centeredCaption}>
                        {privateChat
                            ? 'This screen is only available for groups.'
                            : describeGroupInfoError(error)}
                    </AppText>
                    {!privateChat && (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Retry loading group info"
                            style={styles.retryButton}
                            onPress={(): void => {
                                void infoQuery.refetch();
                            }}
                        >
                            <Text style={styles.retryText}>Retry</Text>
                        </Pressable>
                    )}
                    <FormButton
                        label="Go back"
                        intent="secondary"
                        onPress={(): void => router.back()}
                    />
                </View>
            </View>
        );
    }

    return (
        <View style={styles.root}>
            <EditorTopBar onBack={handleBack} />
            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                style={styles.flex1}
            >
                <ScrollView
                    contentContainerStyle={styles.scroll}
                    keyboardShouldPersistTaps="handled"
                >
                    <View style={styles.photoBlock}>
                        <AvatarGallery
                            avatars={photoItems}
                            maxAvatars={MAX_GROUP_AVATARS}
                            uploading={uploadAvatar.isPending}
                            pendingFileName={
                                (deleteAvatar.isPending
                                    ? deleteAvatar.variables
                                    : null) ??
                                (setMainAvatar.isPending
                                    ? setMainAvatar.variables
                                    : null)
                            }
                            disabled={photoBusy}
                            subject="Group photo"
                            onPressAvatar={(index): void =>
                                setViewerIndex(index)
                            }
                            onLongPressAvatar={(index): void =>
                                setViewerIndex(index)
                            }
                            onPressAdd={(): void => {
                                void pickPhoto();
                            }}
                        />
                        {limitHint !== null && (
                            <Text style={styles.limitHint}>{limitHint}</Text>
                        )}
                        {photoError !== null && (
                            <Text
                                style={styles.errorText}
                                accessibilityLiveRegion="polite"
                            >
                                {photoError}
                            </Text>
                        )}
                    </View>

                    <View style={styles.field}>
                        <Text style={styles.label}>Group name</Text>
                        <TextInput
                            value={title}
                            onChangeText={setTitle}
                            multiline={false}
                            maxLength={GROUP_TITLE_MAX_LENGTH}
                            placeholder="Group name"
                            placeholderTextColor={palette.neutral[300]}
                            accessibilityLabel="Group name"
                            style={[
                                styles.input,
                                titleError !== null && styles.inputInvalid,
                            ]}
                        />
                        <Text style={styles.counter}>
                            {title.length}/{GROUP_TITLE_MAX_LENGTH}
                        </Text>
                        {titleError !== null && (
                            <Text style={styles.errorText}>{titleError}</Text>
                        )}
                    </View>

                    <View style={styles.field}>
                        <Text style={styles.label}>Description</Text>
                        <TextInput
                            value={description}
                            onChangeText={setDescription}
                            multiline={true}
                            maxLength={GROUP_DESCRIPTION_MAX_LENGTH}
                            placeholder="What is this group about?"
                            placeholderTextColor={palette.neutral[300]}
                            accessibilityLabel="Group description"
                            style={[styles.input, styles.multiline]}
                            textAlignVertical="top"
                        />
                        <Text style={styles.counter}>
                            {description.trim().length}/
                            {GROUP_DESCRIPTION_MAX_LENGTH}
                        </Text>
                        {descriptionError !== null && (
                            <Text style={styles.errorText}>
                                {descriptionError}
                            </Text>
                        )}
                    </View>

                    {saveError !== null && (
                        <Text
                            style={styles.errorText}
                            accessibilityLiveRegion="polite"
                        >
                            {saveError}
                        </Text>
                    )}

                    <View style={styles.actions}>
                        {saving ? (
                            <View style={styles.savingRow}>
                                <ActivityIndicator
                                    size="small"
                                    color={palette.primary[500]}
                                />
                                <Text style={styles.caption}>Saving…</Text>
                            </View>
                        ) : (
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="Save group info"
                                accessibilityState={{
                                    disabled: !canSaveGroupInfo(
                                        draft,
                                        info,
                                        saving,
                                    ),
                                }}
                                disabled={
                                    !canSaveGroupInfo(draft, info, saving)
                                }
                                style={({ pressed }) => [
                                    styles.saveButton,
                                    pressed && styles.pressed,
                                    !canSaveGroupInfo(draft, info, saving) &&
                                        styles.disabled,
                                ]}
                                onPress={(): void => {
                                    void handleSave();
                                }}
                            >
                                <Text style={styles.saveButtonText}>Save</Text>
                            </Pressable>
                        )}
                        <FormButton
                            label="Cancel"
                            intent="secondary"
                            onPress={handleBack}
                        />
                    </View>
                </ScrollView>
            </KeyboardAvoidingView>
            <AvatarViewer
                visible={viewerIndex !== null}
                avatars={photoItems}
                initialIndex={viewerIndex ?? 0}
                busy={photoBusy}
                pendingFileName={
                    (deleteAvatar.isPending ? deleteAvatar.variables : null) ??
                    (setMainAvatar.isPending ? setMainAvatar.variables : null)
                }
                subject="Group photo"
                setMainLabel="Set as group photo"
                deleteLabel="Delete"
                deleteConfirmTitle="Delete this group photo?"
                deleteConfirmMessage="It will be removed for everyone in the group."
                onClose={(): void => setViewerIndex(null)}
                onSetMain={handleSetMainPhoto}
                onDelete={handleDeletePhoto}
            />
        </View>
    );
}

function EditorTopBar({ onBack }: { onBack: () => void }): React.ReactElement {
    return (
        <View style={styles.topBar}>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel="Go back"
                style={styles.backButton}
                onPress={onBack}
            >
                <Text style={styles.backText}>‹</Text>
            </Pressable>
            <Text style={styles.topBarTitle} numberOfLines={1}>
                Group info
            </Text>
            <View style={styles.topBarSpacer} />
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: palette.neutral[50] },
    flex1: { flex: 1 },
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
    backText: { fontSize: 32, lineHeight: 34, color: palette.neutral[900] },
    topBarTitle: {
        flex: 1,
        textAlign: 'center',
        fontSize: 16,
        fontWeight: '700',
        color: palette.neutral[900],
    },
    topBarSpacer: { width: 44 },
    scroll: {
        padding: spacing.md,
        gap: spacing.lg,
        paddingBottom: spacing.xl,
    },
    photoBlock: {
        alignItems: 'center',
        gap: spacing.sm,
        padding: spacing.md,
        borderRadius: radii.md,
        backgroundColor: palette.neutral[0],
    },
    photoSpinner: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radii.full,
        backgroundColor: 'rgba(0,0,0,0.35)',
    },
    photoActions: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'center',
        gap: spacing.xs,
    },
    secondaryButton: {
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.xs,
        borderRadius: radii.sm,
        borderWidth: 1,
        borderColor: palette.primary[500],
    },
    secondaryButtonText: {
        color: palette.primary[700],
        fontSize: 14,
        fontWeight: '600',
    },
    dangerButton: {
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.xs,
        borderRadius: radii.sm,
        borderWidth: 1,
        borderColor: palette.semantic.danger,
    },
    dangerButtonText: {
        color: palette.semantic.danger,
        fontSize: 14,
        fontWeight: '600',
    },
    field: {
        gap: spacing.xxs,
        padding: spacing.md,
        borderRadius: radii.md,
        backgroundColor: palette.neutral[0],
    },
    label: {
        ...typography.caption,
        color: palette.neutral[700],
        fontWeight: '600',
    },
    input: {
        borderWidth: 1,
        borderColor: palette.neutral[300],
        borderRadius: radii.sm,
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xs + 2,
        fontSize: 16,
        color: palette.neutral[900],
        backgroundColor: palette.neutral[0],
    },
    inputInvalid: { borderColor: palette.semantic.danger },
    multiline: { minHeight: 110 },
    counter: {
        ...typography.caption,
        alignSelf: 'flex-end',
        color: palette.neutral[500],
    },
    errorText: {
        ...typography.caption,
        color: palette.semantic.danger,
        textAlign: 'center',
    },
    actions: { gap: spacing.xs },
    saveButton: {
        alignItems: 'center',
        paddingVertical: spacing.sm + 2,
        borderRadius: radii.sm,
        backgroundColor: palette.primary[500],
    },
    saveButtonText: {
        color: palette.neutral[0],
        fontSize: 16,
        fontWeight: '600',
    },
    savingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.xs,
        paddingVertical: spacing.sm,
    },
    caption: typography.caption,
    limitHint: {
        ...typography.caption,
        color: palette.neutral[500],
        textAlign: 'center',
    },
    disabled: { opacity: 0.5 },
    pressed: { opacity: 0.75 },
    centered: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.sm,
        padding: spacing.lg,
    },
    centeredCaption: { textAlign: 'center' },
    retryButton: {
        borderRadius: radii.sm,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.xs,
        backgroundColor: palette.primary[500],
    },
    retryText: { color: palette.neutral[0], fontSize: 14, fontWeight: '600' },
});
