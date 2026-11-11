import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { inviteCodeFromUrl } from './invite-links-model';

/**
 * Tap handling for links found in message bodies and on the invite-links
 * screen.
 *
 * A NiazChat invite link opens the in-app join screen with the extracted code
 * (never the raw URL, so a forged scheme/host cannot redirect elsewhere). Any
 * other absolute URL is handed to the OS. The join screen itself fetches the
 * preview from the backend, so expired/revoked/used-up codes surface there as
 * one generic "invalid or expired" state.
 */

/** One push for one tap; a double tap must not stack the join screen twice. */
const JOIN_PUSH_GUARD_MS = 800;
let lastJoinPushAt = 0;

/** Opens `/join/<code>` when the URL carries a valid invite code. */
export function openJoinLink(url: string): boolean {
    const code = inviteCodeFromUrl(url);
    if (code === null) {
        return false;
    }
    const now = Date.now();
    if (now - lastJoinPushAt < JOIN_PUSH_GUARD_MS) {
        return true;
    }
    lastJoinPushAt = now;
    router.push({ pathname: '/join/[code]', params: { code } });
    return true;
}

/** Invite link → in-app join flow; every other URL → the system browser/app. */
export function openMessageLink(url: string): void {
    if (openJoinLink(url)) {
        return;
    }
    void Linking.openURL(url).catch((): void => undefined);
}
