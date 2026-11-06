import { Slot } from 'expo-router';
import { useAuthScreenGuard, useIsRestoringSession } from '../../features/auth';
import { GatePlaceholder } from '../../shared/components';

/**
 * Guest zone. Authenticated sessions are bounced to the protected area
 * (`useAuthScreenGuard`); nothing renders until session restoration finishes,
 * so a restored login never flashes the sign-in screens.
 */

export default function AuthLayout(): React.ReactElement {
  const isRestoring = useIsRestoringSession();
  // Runs the guard effect: authenticated users get redirected to /(app).
  useAuthScreenGuard('guest-only');

  if (isRestoring) {
    return <GatePlaceholder />;
  }

  return <Slot />;
}
