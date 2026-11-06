import { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { z } from 'zod';
import {
    AppText,
    FormButton,
    FormField,
    Screen,
    palette,
    spacing,
} from '../../shared/components';
import {
    describeProfileError,
    useProfile,
    useUpdateProfile,
} from '../../features/users';

/**
 * Edit profile (`PUT /user/updateme`).
 *
 * Backend contract (docs/mobile-api/users.md + updateUser.dto.ts):
 * ALL three fields are required on the wire (validation has no @IsOptional).
 * - `name`: string, max 20 chars.
 * - `username`: 5–32 chars, must match /^[a-zA-Z][a-zA-Z0-9_]*[a-zA-Z0-9]$/,
 *   unique — 409 `{ message: 'username already exists' }` otherwise.
 * - `biografy`: string, max 100 chars.
 * There is NOTHING else editable (no email, no first/last split).
 */

const editSchema = z.object({
    name: z
        .string()
        .trim()
        .min(1, 'Name is required')
        .max(20, 'Up to 20 characters'),
    username: z
        .string()
        .trim()
        .min(5, 'At least 5 characters')
        .max(32, 'Up to 32 characters')
        .regex(
            /^[a-zA-Z][a-zA-Z0-9_]*[a-zA-Z0-9]$/,
            'Must start with a letter and use letters, digits or _ only',
        ),
    biografy: z.string().max(100, 'Up to 100 characters'),
});

type EditFormValues = z.infer<typeof editSchema>;

export default function ProfileEditScreen(): React.ReactElement {
    const router = useRouter();
    const profile = useProfile();
    const updateProfile = useUpdateProfile();
    const [submittedError, setSubmittedError] = useState<string | null>(null);

    const form = useForm<EditFormValues>({
        resolver: zodResolver(editSchema),
        mode: 'onSubmit',
        defaultValues: { name: '', username: '', biografy: '' },
    });

    // Pre-fill as soon as the cached profile resolves (screens wait on the
    // shared `GET /auth/getme` cache; if empty it fetches itself).
    const user = profile.view.profile;
    useEffect(() => {
        if (user === null) {
            return;
        }
        form.reset({
            name: user.name,
            username: user.username ?? '',
            biografy: user.biografy ?? '',
        });
    }, [user, form]);

    const onSubmit = form.handleSubmit(async (values): Promise<void> => {
        if (updateProfile.isPending) {
            return; // no duplicate submissions
        }
        setSubmittedError(null);
        try {
            await updateProfile.mutateAsync(values);
            // Cache is invalidated inside the hook; navigate back to the fresh view.
            router.back();
        } catch (error) {
            setSubmittedError(describeProfileError(error));
        }
    });

    if (profile.isLoading || user === null) {
        return (
            <Screen style={styles.center}>
                <ActivityIndicator size="large" color={palette.primary[500]} />
            </Screen>
        );
    }

    return (
        <Screen style={styles.screen} withTopInset={true}>
            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                style={styles.flex1}
            >
                <ScrollView
                    contentContainerStyle={styles.scroll}
                    keyboardShouldPersistTaps="handled"
                >
                    <AppText variant="title">Edit profile</AppText>
                    <AppText variant="caption" style={styles.captionNote}>
                        Name, username and bio are the only editable fields;
                        they are all sent on save (required by the backend).
                    </AppText>

                    <Controller
                        control={form.control}
                        name="name"
                        render={({
                            field: { onChange, onBlur, value },
                        }): React.ReactElement => (
                            <FormField
                                label="Name (max 20)"
                                value={value}
                                onChangeText={onChange}
                                onBlur={onBlur}
                                error={
                                    form.formState.errors.name?.message ?? null
                                }
                                maxLength={20}
                                accessibilityLabel="Name"
                            />
                        )}
                    />

                    <Controller
                        control={form.control}
                        name="username"
                        render={({
                            field: { onChange, onBlur, value },
                        }): React.ReactElement => (
                            <FormField
                                label="Username (5–32, letters/digits/_)"
                                value={value}
                                onChangeText={onChange}
                                onBlur={onBlur}
                                error={
                                    form.formState.errors.username?.message ??
                                    null
                                }
                                autoCapitalize="none"
                                autoCorrect={false}
                                maxLength={32}
                                accessibilityLabel="Username"
                            />
                        )}
                    />

                    <Controller
                        control={form.control}
                        name="biografy"
                        render={({
                            field: { onChange, onBlur, value },
                        }): React.ReactElement => (
                            <FormField
                                label="Bio (max 100)"
                                value={value}
                                onChangeText={onChange}
                                onBlur={onBlur}
                                error={
                                    form.formState.errors.biografy?.message ??
                                    null
                                }
                                multiline={true}
                                maxLength={100}
                                accessibilityLabel="Bio"
                            />
                        )}
                    />

                    {submittedError !== null && (
                        <Text style={styles.errorText}>{submittedError}</Text>
                    )}

                    <View style={styles.actions}>
                        {updateProfile.isPending || profile.isLoading ? (
                            <ActivityIndicator
                                size="small"
                                color={palette.primary[500]}
                            />
                        ) : (
                            <>
                                <FormButton
                                    label="Save"
                                    onPress={(): void => {
                                        void onSubmit();
                                    }}
                                />
                                <FormButton
                                    label="Cancel"
                                    intent="secondary"
                                    onPress={(): void => router.back()}
                                />
                            </>
                        )}
                    </View>
                </ScrollView>
            </KeyboardAvoidingView>
        </Screen>
    );
}

const styles = StyleSheet.create({
    screen: { gap: spacing.sm, paddingHorizontal: spacing.lg },
    flex1: { flex: 1 },
    scroll: { gap: spacing.sm, paddingVertical: spacing.xs },
    captionNote: { color: palette.neutral[500] },
    actions: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.md },
    errorText: { color: palette.semantic.danger },
    center: { alignItems: 'center', justifyContent: 'center' },
});
