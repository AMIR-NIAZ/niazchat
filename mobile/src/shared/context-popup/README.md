# shared/context-popup

One host for all floating context popups (message menu, quick reactions,
reactor list, chat-list menu). The host is mounted once per app shell, as a
sibling **after** the navigator, so it covers the screens and their headers.

## Architecture

- **No `Modal`.** The popup is a `View` overlay (`absoluteFill`, `zIndex` /
  `elevation` 1000) inside the app tree. Android hardware back is handled with
  `BackHandler` while a session is open.
- **No measurement, no wait.** Every piece of chrome has a fixed size
  (`popup-layout.ts`: 44 px menu rows, 236 px menu, 52 px pill, fixed paddings),
  so `open({ anchor })` computes the whole layout synchronously and commits it
  in a single `setState`. The first frame is already complete; there is no
  `onLayout` round trip and no empty container.
- **The list is never touched.** The live bubble/row is not hidden, not lifted,
  not re-rendered; no props change when a popup opens or closes. The popup draws
  a static copy of the pressed element exactly over the measured window rect
  (`measureInWindow`) and removes it at the end.
- **One shared value.** `progress` (Reanimated, `useSharedValue(0)`) is the only
  clock; every layer derives its style from it in `useAnimatedStyle` on the UI
  thread. Only `opacity` and `transform` are animated, so nothing goes through
  the JS thread per frame. The host holds exactly one `useState` (`session`).

| layer          | derived from `progress`                                  |
| -------------- | -------------------------------------------------------- |
| scrim / blur   | opacity `progress * POPUP_SCRIM_OPACITY`                 |
| preview copy   | translateY `[0, 1]` → `[anchorY - previewY, 0]`          |
| reactions pill | opacity + scale `0.88 → 1` over `[0, 0.6]`               |
| action menu    | opacity + scale `0.9 → 1` + 8 px translate over `[0, 0.5]` |

## Timing and sequencing

| action                | timing                                                |
| --------------------- | ----------------------------------------------------- |
| open                  | `withTiming(1)` 200 ms `Easing.out(Easing.cubic)`     |
| close                 | `withTiming(0)` 160 ms `Easing.bezier(.4,0,.2,1)`     |
| Reduce Motion         | opacity only, 90 ms, no transforms                    |

`finishClose()` is called from the close animation's completion callback (UI
thread → `runOnJS`). It drops the session and then runs the picked action, so
**nothing** sets state, refetches or invalidates between the close starting and
the overlay being gone. A `closingRef` ignores double taps, backdrop taps and the
back button while closing; it resets on open.

`open()` also resets `progress` before committing, so a re-open never paints one
frame of the previous (finished) timeline.

## Layout

`computePopupLayout({ anchor, window, insets, keyboardHeight, itemCount,
reactionCount, align, centerSize })` returns `previewX/Y/Width/Height`, the
`reactions` and `menu` rects, `center` (reactor list), `placement`
(`'below'`/`'above'`) and `clipped`.

The stack is: pill, gap, copy, gap, menu. When the menu would not fit below the
source, the sandwich flips (`placement: 'above'`). `previewY` is rounded and the
copy compensates it with its `translateY`, so at `progress = 0` the copy sits on
the bubble's exact rect (x/width stay unrounded). Tall copies are clipped to 45%
of the window height (no fade).

## Backdrop

iOS: `BlurView` + a faint dim, faded with `progress`. Android: **no
`BlurView`** — a `Modal`-less overlay can still not blur another window on
Android in Expo Go, and the native view only falls back to none, so Android
renders the scrim alone (`palette.background` at `POPUP_SCRIM_OPACITY`).
Both cover the status/navigation bar areas because the overlay is a normal
full-screen `View`.
