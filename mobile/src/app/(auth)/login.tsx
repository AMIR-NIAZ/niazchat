import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
    AppText,
    FormButton,
    FormField,
    GlassCard,
    Screen,
    palette,
    spacing,
} from '../../shared/components';
import { useAuthFlow, useAuthStore } from '../../features/auth';
import {
    sendOtpSchema,
    type SendOtpFormValues,
} from '../../features/auth/validators';

/**
 * Step 1 of OTP sign-in: `POST /auth/send-otp`.
 * Errors render inline; a 60-second throttle (429) is explained by the flow hook.
 */

export default function LoginScreen(): React.ReactElement {
    const { requestOtp, requesting } = useAuthFlow();
    const sessionNotice = useAuthStore((state) => state.sessionNotice);
    const [submitError, setSubmitError] = useState<string | null>(null);

    const {
        control,
        handleSubmit,
        formState: { errors },
    } = useForm<SendOtpFormValues>({
        resolver: zodResolver(sendOtpSchema),
        mode: 'onChange',
        defaultValues: { phone: '+98' },
    });

    const onSubmit = handleSubmit(async (values): Promise<void> => {
        setSubmitError(null);
        const result = await requestOtp(values);
        if (!result.success && result.message !== undefined) {
            setSubmitError(result.message);
        }
    });

    return (
        <Screen style={styles.screen}>
            <View style={styles.brand}>
                <View style={styles.logo}>
                    <AppText variant="title" style={styles.logoText}>
                        N
                    </AppText>
                </View>
                <AppText variant="display">NiazChat</AppText>
                <AppText variant="caption" style={styles.tagline}>
                    Private conversations, beautifully quiet.
                </AppText>
            </View>

            <GlassCard padding={spacing.lg} radius={28} floating={true}>
                {sessionNotice !== null && (
                    <AppText variant="caption" style={styles.notice}>
                        {sessionNotice}
                    </AppText>
                )}
                <AppText variant="heading">Sign in</AppText>
                <AppText variant="caption" style={styles.hint}>
                    Enter your Iranian mobile number. We&apos;ll send a one-time
                    code by SMS.
                </AppText>

                <Controller
                    control={control}
                    name="phone"
                    render={({
                        field: { onChange, onBlur, value },
                    }): React.ReactElement => (
                        <FormField
                            label="Phone number"
                            error={errors.phone?.message ?? null}
                            value={value}
                            keyboardType="phone-pad"
                            autoComplete="tel"
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

                <View style={styles.actions}>
                    {requesting ? (
                        <ActivityIndicator
                            size="small"
                            color={palette.primary[300]}
                        />
                    ) : (
                        <FormButton
                            onPress={(): void => {
                                void onSubmit();
                            }}
                            label="Send code"
                        />
                    )}
                </View>
            </GlassCard>
        </Screen>
    );
}

const styles = StyleSheet.create({
    screen: {
        gap: spacing.lg,
        paddingHorizontal: spacing.lg,
        justifyContent: 'center',
    },
    brand: { alignItems: 'center', gap: spacing.xxs },
    logo: {
        width: 64,
        height: 64,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: palette.glass.accent,
        borderWidth: 1,
        borderColor: palette.border.accent,
        marginBottom: spacing.sm,
    },
    logoText: { color: palette.highlight, fontSize: 28 },
    tagline: { color: palette.text.muted, textAlign: 'center' },
    hint: { color: palette.text.secondary, lineHeight: 18 },
    notice: {
        color: palette.primary[700],
        backgroundColor: palette.glass.accent,
        borderRadius: 8,
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xxs,
    },
    error: { color: palette.semantic.danger },
    actions: { marginTop: spacing.xs },
});
