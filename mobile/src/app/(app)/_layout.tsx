import { Slot } from 'expo-router';
import { useAuthScreenGuard, useIsRestoringSession } from '../../features/auth';
import { GatePlaceholder } from '../../shared/components';

/**
 * Protected zone. Guests are redirected to the signIn screens; the guard also
 * re-engages after every logout (store flips to 'guest').
 */

export default function ProtectedLayout(): React.ReactElement {
  const isRestoring = useIsRestoringSession();
  // Runs the guard effect: guests get redirected to /(auth)/login.
  useAuthScreenGuard('protected');

  if (isRestoring) {
    return <GatePlaceholder />;
  }

  return <Slot />;
}
