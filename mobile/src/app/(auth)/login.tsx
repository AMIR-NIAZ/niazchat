import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  AppText,
  FormButton,
  FormField,
  Screen,
  spacing,
  typography,
  palette,
} from '../../shared/components';
import { useAuthFlow } from '../../features/auth';
import { sendOtpSchema, type SendOtpFormValues } from '../../features/auth/validators';

/**
 * Step 1 of OTP sign-in: `POST /auth/send-otp`.
 * Errors render inline; a 60-second throttle (429) is explained by the flow hook.
 */

export default function LoginScreen(): React.ReactElement {
  const { requestOtp, requesting } = useAuthFlow();
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
      <AppText variant="title">Sign in to NiazChat</AppText>
      <AppText style={styles.hint}>
        Enter your Iranian mobile number. We&apos;ll send a one-time code by SMS.
      </AppText>

      <Controller
        control={control}
        name="phone"
        render={({ field: { onChange, onBlur, value } }): React.ReactElement => (
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

      {submitError !== null && <AppText style={styles.error}>{submitError}</AppText>}

      <View style={styles.actions}>
        {requesting ? (
          <ActivityIndicator size="small" />
        ) : (
          <FormButton onPress={onSubmit} label="Send code" />
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { gap: spacing.md, paddingHorizontal: spacing.lg, justifyContent: 'center' },
  hint: { color: palette.neutral[500] },
  error: { ...typography.caption, color: palette.semantic.danger },
  actions: { marginTop: spacing.sm },
});
