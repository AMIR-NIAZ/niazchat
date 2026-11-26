import { Slot, useGlobalSearchParams } from 'expo-router';
import { useAuthScreenGuard, useIsRestoringSession } from '../../features/auth';
import { GatePlaceholder } from '../../shared/components';

/**
 * Guest zone. Authenticated sessions are bounced to the protected area
 * (`useAuthScreenGuard`); nothing renders until session restoration finishes,
 * so a restored login never flashes the sign-in screens.
 *
 * `?mode=add` is the "Add account" flow: it is opened FROM an authenticated
 * session, so the guest-only redirect is skipped and the other accounts stay
 * saved.
 */

export default function AuthLayout(): React.ReactElement {
  const isRestoring = useIsRestoringSession();
  const params = useGlobalSearchParams<{ mode?: string }>();
  const addingAccount = params.mode === 'add';
  // Runs the guard effect: authenticated users get redirected to /(app),
  // except while they are adding another account.
  useAuthScreenGuard(addingAccount ? 'none' : 'guest-only');

  if (isRestoring) {
    return <GatePlaceholder />;
  }

  return <Slot />;
}
