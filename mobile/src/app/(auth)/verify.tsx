import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useLocalSearchParams, router } from 'expo-router';
import {
    AppText,
    FormButton,
    FormField,
    GlassCard,
    Screen,
    palette,
    spacing,
} from '../../shared/components';
import { useAuthFlow } from '../../features/auth';
import {
    phoneSchema,
    verifyOtpSchema,
    type VerifyOtpFormValues,
} from '../../features/auth/validators';
import { useTheme, useThemedStyles } from '../../shared/theme';
import type { AppTheme } from '../../shared/theme';

/**
 * Step 2 of OTP sign-in: `POST /auth/verify-otp`.
 * Creates the user server-side on first login, then persists the JWT pair.
 * The backend allows only one pending code per phone (60 s TTL) — resending
 * while a code is still live returns the documented 429 `{ message: 'code sent' }`.
 */

type VerifyRouteParams = { phone?: string | string[]; mode?: string };

export default function VerifyScreen(): React.ReactElement {
    const theme = useTheme();
    const styles = useThemedStyles(createStyles);
    const params = useLocalSearchParams<VerifyRouteParams>();
    const phone: string = typeof params.phone === 'string' ? params.phone : '';
    const validPhone = phoneSchema.safeParse(phone).success;

    const { confirmOtp, resend, verifying } = useAuthFlow({
        addingAccount: params.mode === 'add',
    });
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);

    const {
        control,
        handleSubmit,
        formState: { errors },
    } = useForm<VerifyOtpFormValues>({
        resolver: zodResolver(verifyOtpSchema),
        mode: 'onChange',
        defaultValues: { phone, code: '' },
    });

    const onSubmit = handleSubmit(async (values): Promise<void> => {
        setSubmitError(null);
        const result = await confirmOtp({
            phone: values.phone,
            code: values.code,
        });
        if (!result.success) {
            setSubmitError(
                result.message ?? 'Sign-in failed. Please try again.',
            );
        }
    });

    const onResend = async (): Promise<void> => {
        setNotice(null);
        setSubmitError(null);
        const result = await resend(phone);
        if (result.message !== undefined) {
            if (result.success) {
                setNotice(result.message);
            } else {
                setSubmitError(result.message);
            }
        }
    };

    if (!validPhone) {
        return (
            <Screen style={styles.screen}>
                <GlassCard padding={spacing.lg}>
                    <AppText variant="title">Sign-in</AppText>
                    <AppText variant="caption">
                        This screen must be entered through the code request
                        flow.
                    </AppText>
                    <FormButton
                        intent="secondary"
                        label="Back to sign in"
                        onPress={(): void => {
                            router.replace('/(auth)/login');
                        }}
                    />
                </GlassCard>
            </Screen>
        );
    }

    return (
        <Screen style={styles.screen}>
            <GlassCard padding={spacing.lg} radius={28} floating={true}>
                <AppText variant="title">Enter the code</AppText>
                <AppText variant="caption" style={styles.hint}>
                    We sent a one-time code to {phone}. Codes expire after 60
                    seconds.
                </AppText>

                <Controller
                    control={control}
                    name="code"
                    render={({
                        field: { onChange, onBlur, value },
                    }): React.ReactElement => (
                        <FormField
                            label="Code"
                            error={errors.code?.message ?? null}
                            value={value}
                            keyboardType="number-pad"
                            onChangeText={onChange}
                            onBlur={onBlur}
                        />
                    )}
                />

                {submitError !== null && (
                    <AppText variant="caption" style={styles.error}>
                        {submitError}
                    </AppText>
                )}
                {notice !== null && (
                    <AppText variant="caption" style={styles.notice}>
                        {notice}
                    </AppText>
                )}

                <View style={styles.actions}>
                    {verifying ? (
                        <ActivityIndicator
                            size="small"
                            color={theme.accent}
                        />
                    ) : (
                        <>
                            <FormButton
                                onPress={(): void => {
                                    void onSubmit();
                                }}
                                label="Verify & sign in"
                            />
                            <FormButton
                                intent="secondary"
                                label="Resend code"
                                onPress={(): void => {
                                    void onResend();
                                }}
                            />
                        </>
                    )}
                </View>
            </GlassCard>
        </Screen>
    );
}

const createStyles = (theme: AppTheme) =>
    StyleSheet.create({
    screen: {
        gap: spacing.md,
        paddingHorizontal: spacing.lg,
        justifyContent: 'center',
    },
    hint: { color: theme.colors.textSecondary, lineHeight: 18 },
    error: { color: theme.colors.danger },
    notice: { color: theme.colors.success },
    actions: { marginTop: spacing.xs, gap: spacing.xs },
});
