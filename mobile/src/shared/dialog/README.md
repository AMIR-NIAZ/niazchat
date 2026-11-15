# shared/dialog

One host for every themed dialog and toast in the app. It replaces
the native Alert API (`alert` / `prompt`) and `ToastAndroid`: **nothing here
uses `Modal`**, and no screen imports `Alert` from `react-native`.

The provider is mounted once in `src/app/_layout.tsx`, as a sibling of the
navigator inside `ContextPopupProvider`, so the overlay (`zIndex` /
`elevation` 1100) covers screens, their headers, the context popup (1000) and
the floating tab bar.

## API

```ts
import { dialog, toast, useDialog } from '../shared/dialog';

// 1. Plain notice — one "OK" button, runs its callback after the close.
dialog.alert('Link copied');

// 2. Decision — resolves true only when the action is pressed.
const confirmed = await dialog.confirm({
    title: 'Delete this photo?',
    message: 'It will be removed from your profile for everyone.',
    confirmText: 'Delete',
    destructive: true,
});
if (confirmed) {
    await deletePhoto(fileName);
}

// 3. Full control — same shape as the native alert, plus a tone and styles.
dialog.show({
    title: 'Microphone access needed',
    message: 'Allow microphone access in Settings to record voice messages.',
    tone: 'warning',
    buttons: [
        { text: 'Not now', style: 'cancel' },
        { text: 'Open settings', onPress: () => void Linking.openSettings() },
    ],
});

// 4. Non-blocking confirmation (pill under the safe area, ~2.5 s).
toast.show('User unbanned');
toast.show('Could not copy link', { tone: 'danger' });
```

`useDialog()` returns the same object as `dialog`, for symmetry inside
components. All functions are importable from plain async code (mutation
callbacks, permission checks) with no hook.

### Rules of thumb

| use                                       | use                                |
| ----------------------------------------- | ---------------------------------- |
| error that needs attention                | `dialog.show({ tone: 'danger' })`  |
| confirmation / destructive decision       | `dialog.confirm({ destructive })`  |
| success or info with no decision          | `toast.show(...)`                  |

### Behaviour

- **Queue.** One dialog at a time; extra requests wait and appear in order.
  Toasts queue the same way.
- **Dismiss.** Android back and a scrim tap close the dialog when
  `cancelable !== false`; both are consumed while a dialog is visible.
  A `confirm()` dismissed that way resolves `false`.
- **Handler timing.** A synchronous `onPress` and a `confirm()` resolution run
  after the exit animation. An `async` handler runs while the card is open:
  its button shows a spinner, taps are ignored until it settles, the card
  closes on resolve, and a rejection keeps it open (the caller reports the
  error).
- **Animation.** Reanimated shared values only, no per-frame React state.
  Open: 180 ms scrim + spring card (0.9 → 1, +12 px) + badge pop. Close:
  150 ms `bezier(.4, 0, .2, 1)` to 0.95 and opacity 0. Reduce Motion: opacity
  only, 90 ms.
- **Theme.** Dark purple gradient card, 24 px radius, 1 px white/8% border,
  purple glow; buttons are 48 px pills (filled primary, ghost cancel, red
  destructive), side by side for 1–2 and stacked for 3+.
- **RTL.** Text is centered with `writingDirection: 'auto'`, so Persian and
  mixed-direction strings wrap without clipping.

## Enforcement

Do not import `Alert` from `react-native` in app code. There is no ESLint
config in this package, so the rule is enforced by review plus this note;
`grep -rn "Alert\." src` must stay empty.
