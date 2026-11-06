import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useAuthStore } from './auth-store';
import { describeAuthError, sendOtp, verifyOtp } from './auth-service';
import type { SendOtpFormValues, VerifyOtpFormValues } from './validators';

/**
 * Auth flow orchestration (UI layer). Keeps components free of API/state details.
 *
 * - `requestOtp` → POST /auth/send-otp, then routes to the verify screen.
 * - `confirmOtp` → POST /auth/verify-otp, stores the JWT pair (SecureStore),
 *   opens the Socket.IO connection and enters the protected area.
 * - `resend` → re-runs send-otp; a 429 ("code sent") is treated as success
 *   because the reason is merely the backend's 60-second throttle.
 * - `signOut` → clears SecureStore + socket (client-side logout; the backend
 *   does not expose a logout/revocation endpoint).
 */

export interface RequestOtpResult {
  success: boolean;
  message?: string;
}

export function useAuthFlow(): {
  requesting: boolean;
  verifying: boolean;
  requestOtp: (values: SendOtpFormValues) => Promise<RequestOtpResult>;
  confirmOtp: (values: Omit<VerifyOtpFormValues, 'phone'> & { phone: string }) => Promise<RequestOtpResult>;
  resend: (phone: string) => Promise<RequestOtpResult>;
  signOut: () => Promise<void>;
} {
  const router = useRouter();
  const storeSession = useAuthStore((state) => state.storeSession);
  const clearSession = useAuthStore((state) => state.clearSession);
  const [requesting, setRequesting] = useState(false);
  const [verifying, setVerifying] = useState(false);

  const requestOtp = async (values: SendOtpFormValues): Promise<RequestOtpResult> => {
    setRequesting(true);
    try {
      await sendOtp({ phone: values.phone });
      router.push({ pathname: '/(auth)/verify', params: { phone: values.phone } });
      return { success: true };
    } catch (error) {
      return { success: false, message: describeAuthError(error) };
    } finally {
      setRequesting(false);
    }
  };

  const confirmOtp = async (
    values: Omit<VerifyOtpFormValues, 'phone'> & { phone: string },
  ): Promise<RequestOtpResult> => {
    setVerifying(true);
    try {
      const tokens = await verifyOtp({ phone: values.phone, code: values.code });
      await storeSession(tokens.accessToken, tokens.refreshToken);
      router.replace('/(app)');
      return { success: true };
    } catch (error) {
      return { success: false, message: describeAuthError(error) };
    } finally {
      setVerifying(false);
    }
  };

  const resend = async (phone: string): Promise<RequestOtpResult> => {
    try {
      await sendOtp({ phone });
      return { success: true, message: 'Code sent.' };
    } catch (error) {
      // Backend returns 429 with "code sent" when a code is already cached (60 s TTL).
      const apiMessage =
        error instanceof Error && 'statusCode' in error
          ? (error as { statusCode: number }).statusCode
          : undefined;
      if (apiMessage === 429) {
        return { success: true, message: 'A code was already sent. Please wait.' };
      }
      return { success: false, message: describeAuthError(error) };
    }
  };

  const signOut = async (): Promise<void> => {
    await clearSession();
    router.replace('/(auth)/login');
  };

  return { requesting, verifying, requestOtp, confirmOtp, resend, signOut };
}
