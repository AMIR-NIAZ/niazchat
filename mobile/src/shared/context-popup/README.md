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
- **The list is never re-rendered.** The popup draws a static copy of the
  pressed element exactly over the measured window rect (`measureInWindow`) and
  removes it at the end. The live row is hidden through ONE opacity-only shared
  value (`usePopupHidden`): no props, no state, no layout, no scroll position
  changes when a popup opens or closes, so the same element appears to lift.
- **Two clocks.** `progress` (Reanimated, `useSharedValue(0)`) is the timing
  clock: scrim, preview copy, opacity of every layer. `pop` (and its menu twin
  started 30 ms later) is a damped spring used ONLY by the reactions pill and
  the action menu on open — scale `0.86 → 1` and ±8 px translate, with a few
  percent of overshoot. On close both follow `progress` back with plain timing.
  Every style is still derived in `useAnimatedStyle` on the UI thread; the host
  holds exactly one `useState` (`session`).

| layer          | derived from                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------- |
| scrim / blur   | opacity `progress * POPUP_SCRIM_OPACITY`                                                                      |
| preview copy   | translateY `[0, 1]` → `[anchorY - previewY, 0]` from `progress`; scale `[0, 1]` → `[1, 1.035]` from `copyPop` |
| reactions pill | opacity `progress` over `[0, 0.6]`; scale/translate `pop`                                                     |
| action menu    | opacity `progress` over `[0, 0.5]`; scale/translate delayed `pop`                                             |

## Timing and sequencing

| action           | timing                                                                                        |
| ---------------- | --------------------------------------------------------------------------------------------- |
| open             | `progress`: `withTiming(1)` 220 ms `Easing.out(Easing.cubic)`                                 |
| open popups      | pill: `withSpring(1, {damping:14, stiffness:260, mass:0.7})`; menu: same with `withDelay(30)` |
| open copy bubble | `copyPop`: `withSpring(1, {damping:11, stiffness:240, mass:0.7})`, scale rests at 1.035       |
| close            | `progress`, `pop`, menu pop, `copyPop`: `withTiming(0)` 160 ms `Easing.bezier(.4,0,.2,1)`     |
| Reduce Motion    | opacity only, 90 ms, no transforms, no spring                                                 |

## Hiding the live source

`ContextPopupConfig.sourceKey` names the pressed element (`message.key` for a
message, `chat:<id>` for a chat row). `usePopupHidden(key)` returns
`{ opacity: hiddenKey.value === key ? 0 : 1 }` from `useAnimatedStyle`, so rows
hide on the UI thread with no re-render and no layout change. It is applied to
the live message bubble (every type: text, media, voice, file, forwarded,
replies) and to the chat-list row; the static preview rendered inside the popup
never applies it.

The key is only touched in this order:

1. `open()` commits the session; the copy is already painted on the anchor at
   `progress = 0`.
2. The entrance effect THEN sets `hiddenKey` to `sourceKey`: the copy is
   exactly over the row at that moment, so the swap is invisible. A centered
   sheet (reactor list) draws no copy, so it never hides a row.
3. On close, `progress` reaches 0 with the copy back on the row; the completion
   callback reveals the row (`hiddenKey = null`) **first**, then on the next
   `requestAnimationFrame` drops the session and runs the picked action.

`finishClose()` and the host-unmount cleanup also clear the key, so a session
can never be dropped with a row left invisible, and re-opening while closing
simply overwrites it with the new `sourceKey`.

`finishClose()` runs from that reveal frame (UI thread → `scheduleOnRN`) and drops
the session right before running the picked action, so **nothing** sets state,
refetches or invalidates between the close starting and the overlay being gone.
A `closingRef` ignores double taps, backdrop taps and the back button while
closing; it resets on open, and `finishClose` returns early if it is no longer
set (a new popup opened before the reveal frame ran).

`open()` also resets `progress`, `pop`, the menu pop and `copyPop` before
committing, so a re-open never paints one frame of the previous (finished)
timeline.

The lifted copy has its own bubble spring (`copyPop`, separate from the pill and
menu springs so their entrance is unchanged): scale `1 → 1.035` with an
overshoot and a rest slightly above the anchor, returning to exactly 1 on close.
It scales about the bubble's anchored edge — `right center` when `align: 'end'`
(mine), `left center` when `align: 'start'`, `center` otherwise — and it is
applied to the copy's outer container, translateY still coming from `progress`.
The copy container is NOT clipped, so the grown copy keeps its whole bubble
(footer/time row included). At `progress = copyPop = 0` the copy is exactly the
live bubble. Reduce Motion skips the scale entirely.

## Layout

`computePopupLayout({ anchor, window, insets, keyboardHeight, itemCount,
reactionCount, align, centerSize })` returns `previewX/Y/Width/Height`, the
`reactions` and `menu` rects, `center` (reactor list), `placement` (always
`'below'`: the menu sits under the copy) and `clipped` (centered cards only).

The stack is: pill, gap, copy, gap, menu, and the copy is never resized:

```
previewWidth  = anchor.width
previewHeight = anchor.height      (no clamp, no crop, no aspect ratio)
menuHeight    = itemCount * MENU_ROW_HEIGHT + MENU_PADDING
```

With room, the copy rests on its anchor, the pill one GAP above it and the menu
one GAP below it:

```
pillBlock = reactions ? REACTION_PILL_HEIGHT + POPUP_GAP : 0
menuBlock = menu      ? POPUP_GAP + menuHeight             : 0
stack     = pillBlock + previewHeight + menuBlock

stackTop = anchor.y - pillBlock
if (stackTop + stack > safeBottom) stackTop -= stackTop + stack - safeBottom
stackTop = max(safeTop, stackTop)      # clamped to the usable area

previewY  = round(stackTop + pillBlock)   # the host compensates with translateY
menuTop   = previewY + previewHeight + POPUP_GAP
pillTop   = stackTop
```

When the stack does not fit, it is moved as ONE block by the missing amount —
up when it would cross the bottom, down when it would cross the top — and then
clamped to the usable area. The copy is never resized and the `POPUP_GAP`
between the parts never changes; a stack taller than the usable area is
simply top-aligned and its lower part runs past the edge.

`safeTop = insets.top + POPUP_SCREEN_MARGIN` and `safeBottom = window.height -
max(insets.bottom, keyboardHeight) - POPUP_SCREEN_MARGIN` (the keyboard top when
it is open). `previewHeight === anchor.height` is an INVARIANT for every message
type (text, media, voice, file): the copy is never clipped, so it always shows
the whole bubble the live row showed, footer included. Only text taller than
the available height is cut by the bottom fade.
`previewY` is rounded and the copy compensates it with its `translateY`, so at
`progress = 0` the copy sits on the bubble's exact rect (x/width stay
unrounded).

## Backdrop

iOS: `BlurView` + a faint dim, faded with `progress`. Android: **no
`BlurView`** — a `Modal`-less overlay can still not blur another window on
Android in Expo Go, and the native view only falls back to none, so Android
renders the scrim alone (`palette.background` at `POPUP_SCRIM_OPACITY`).
Both cover the status/navigation bar areas because the overlay is a normal
full-screen `View`.
