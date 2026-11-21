# Message context popup (long-press menu) — lag diagnostic report

Read-only investigation. No source file was modified; this document is the only
artifact. Date: 2026-11-20.

Scope: the floating context popup that opens on tap/long-press of a chat
message — `mobile/src/shared/context-popup/` plus the call site in
`mobile/src/app/(app)/chat/[chatId].tsx` and the copy it mounts
(`mobile/src/features/messages/message-bubble-preview.tsx`).

Every claim below is tagged:

- **CONFIRMED** — read directly in the code at the cited lines.
- **HYPOTHESIS** — plausible from the code but not measured; how to verify is given.
- **NOT VERIFIED** — stated by the user only, or not measurable from a static read.

No frame rate, duration in frames, device model or profile number in this report
was measured. All timings that appear are constants read from source.

## 0. Environment (as requested, exact versions from `mobile/package.json`)

| Item | Version / value | Evidence |
| --- | --- | --- |
| Expo SDK | `expo ~58.0.25` | `mobile/package.json:22` |
| React Native | `0.88.1` | `mobile/package.json:49` |
| React | `19.3.0` | `mobile/package.json:48` |
| Reanimated | `4.7.1` | `mobile/package.json:51` |
| react-native-worklets | `0.13.0` | `mobile/package.json:56` |
| react-native-gesture-handler | `~3.3.0` | `mobile/package.json:50` |
| expo-image | `~58.0.18` | `mobile/package.json:32` |
| expo-blur | `~58.0.6` | `mobile/package.json:25` |
| Platform under test | Expo Go, Android, not a dev build | user report only |
| List | `FlatList`, `inverted={true}` | `mobile/src/app/(app)/chat/[chatId].tsx:2394-2396` |

Note: the message bubble's long press is **not** a gesture-handler gesture. It is
a React Native `Pressable` (`mobile/src/features/messages/message-bubble.tsx:725-755`).
Gesture-handler v3 is used elsewhere (e.g. the music scrub line), not on the
popup path.

## 1. Symptom

What the popup does today, decomposed from the code path (see section 2), and
what is confirmed vs reported:

| # | Symptom element | Status | Mechanism |
| --- | --- | --- | --- |
| 1 | The popup appears noticeably after the finger has long-pressed (a "late" start, not a smooth pick-up) | CONFIRMED async hop, magnitude NOT VERIFIED | `open()` can only run after `measureInWindow`'s native callback resolves into a JS promise (`message-bubble.tsx:196-206`, `shared/context-popup/measure.ts:13-27`) |
| 2 | The bubble "snaps" at the start instead of lifting | CONFIRMED | The copy has **no opacity animation**: it is painted fully opaque at `progress = 0` (`context-popup.tsx:646-689`), while the live bubble it replaces is still at full/`pressed` opacity until a passive `useEffect` sets `hiddenKey` after the commit (`context-popup.tsx:357-368`); pixel-level proof of the double frame is HYPOTHESIS, verify with React DevTools or a screen recording |
| 3 | The pressed message "jumps"/redraws as the popup opens | CONFIRMED for group chats | The copy is built with different props than the live row: `showSenderName={isGroup && !mineMessage}` and `showAvatar={false}` (`[chatId].tsx:1581-1582`) vs. the live row's run-derived `item.showSenderName` / `item.showAvatar` (`[chatId].tsx:2164-2165`, computed in `message-runs.ts:81-82`) |
| 4 | Large images / video bubbles behave worse | CONFIRMED code cause; severity NOT VERIFIED | A second `expo-image` instance is mounted inside the copy with `transition={150}` and no placeholder (`attachment-grid.tsx:187-201`); video posters mount with `blurRadius` 12 in the idle state (`BLUR_SOFT`, `video-poster.tsx:99-107`) and `transition` 220 when sharp (`138-149`) |
| 5 | Stutter during the open/close motion | HYPOTHESIS (see rank 2) | A spring scales a full bubble subtree (`context-popup.tsx:665-672`) with text + image + rounded clipping; no hardware layer is requested anywhere in the popup path |
| 6 | "Snaps" at the end / one-frame flicker on close | CONFIRMED by code shape; visible severity NOT VERIFIED | On close the copy translates back and the row is revealed one `requestAnimationFrame` before the overlay unmounts (`context-popup.tsx:268-273`, `291-300`); any content mismatch from row 3 shows as the copy swapping to a different-looking bubble |
| 7 | Second-and-later messages behave worse | Reported by user only; partial code support | Messages that continue a sender run get a **sender name added** in the copy that the live bubble does not show (see row 3). This is largest for the 2nd+ message of a run. HYPOTHESIS for perceived severity |
| 8 | Worse with the keyboard open | Reported only; **NOT VERIFIED** | The keyboard only enters the layout math through `keyboardRef` (`context-popup.tsx:227-240`, `popup-layout.ts:122-129`); it does not change the animation path. A keyboard-open popup is also placed higher (`stackTop` clamp), which changes nothing about the frame cost |
| 9 | Only on Android / Expo Go | Reported only; **NOT VERIFIED** (no device profiling) | Android-specific code paths that could matter are listed in section 9; iOS additionally pays for `BlurView`, which Android does not use |

Bubble-type severity ranking from code evidence (not measured):

1. multiple attachments -> 2x2 grid of `expo-image`/poster copies,
2. video (poster + `blurRadius` + download-control ring/SVG),
3. single large image (`LARGE_WIDTH = 240`, height up to 320, `attachment-grid.tsx:47-49`),
4. music (cover `Image` with `transition={120}`, `music-bubble.tsx:194-199`),
5. long text (only text re-raster under the scale; no extra decode),
6. plain short text (cheapest case).

## 2. Architecture: finger-down to fully open, and back

There is no `Modal` and no `onLayout` wait on the open path. The popup host is a
plain absolutely-positioned `View` mounted once in the app shell
(`mobile/src/app/_layout.tsx:165-181`, host styles `context-popup.tsx:856-865`).

```
FINGER DOWN on bubble (UI thread, native Pressable)
  |
  | 350 ms  BUBBLE_LONG_PRESS_MS (message-bubble.tsx:122)
  v
onLongPress -> openMenu()                                   [JS thread]
  |  if onOpenMenu === undefined -> return
  v
measureInWindow(bubbleRef) -> Promise                       [JS -> native -> JS]
  |  native measures the Reanimated.View (collapsable={false})
  |  callback resolves the promise (measure.ts:23-35)        1+ frames, NOT VERIFIED
  v
onOpenMenu(message, anchor) = openMessageMenu               [JS thread]
  |  guard: status === 'sent' && id !== null
  |  buildMessageMenuConfig(): builds actions, reactions, and a
  |  React element <MessageBubblePreview .../>               [JS, element only]
  v
popup.open(config)                                          [JS thread]
  |  computePopupLayout(...) - pure math, no measurement      (popup-layout.ts:115)
  |  reset progress/pop/menuPop/copyPop = 0
  |  setSession(next)                                         (context-popup.tsx:309-352)
  v
React render + commit of the overlay subtree                 [JS + native mount]
  |  mounts: backdrop, Pressable, PopupPreview -> MessageBubble copy
  |          (image views / poster / SVG / text laid out here)
  v
useEffect [session] (passive, after paint)                   [JS thread]
  |  1. hiddenKey.value = sourceKey  (live row opacity -> 0)
  |  2. pop.value = withSpring(1)            UI thread worklet
  |     menuPop.value = withDelay(30, spring) UI thread worklet
  |     copyPop.value = withSpring(1)         UI thread worklet
  |     progress.value = withTiming(1, 220 ms) UI thread worklet
  v
Reanimated UI runtime: every frame recomputes 4 useAnimatedStyle closures
  |  scrim opacity / copy translateY / copy scale / pill+menu opacity+scale
  v
POPUP FULLY OPEN

CLOSE (tap backdrop, back, or pick an action)
  close() -> progress/pop/menuPop/copyPop = withTiming(0, 160 ms)   (275-307)
  progress completion worklet -> scheduleOnRN(revealSource)          (294-299)
  revealSource: hiddenKey.value = null; requestAnimationFrame(finishClose)  (268-273)
  finishClose: setSession(null); run pending action; onClose        (243-260)
```

Step-by-step, with threads and state:

| Step | File / function | Thread | Measured / rendered | State that changes |
| --- | --- | --- | --- | --- |
| 1 | `message-bubble.tsx:748-749` `onLongPress` | native gesture, callback on JS | nothing | none |
| 2 | `message-bubble.tsx:196-206` `openMenu` | JS | triggers `measureInWindow` | none |
| 3 | `shared/context-popup/measure.ts:13-41` | native measure, callback on JS | window rect | none |
| 4 | `[chatId].tsx:1622-1627` `openMessageMenu` | JS | builds config + copy element | none yet |
| 5 | `context-popup.tsx:309-352` `open` | JS | pure layout (`popup-layout.ts`) | `sessionRef`, `closingRef`, 4 shared values -> 0 |
| 6 | React commit of `context-popup.tsx:482-580` | JS render, native mount | backdrop, copy (`MessageBubble`), pill, menu | `session` |
| 7 | `context-popup.tsx:357-387` entrance effect | JS sets shared values | nothing rendered | `hiddenKey`, `pop`, `menuPop`, `copyPop`, `progress` |
| 8 | 4 `useAnimatedStyle` worklets | Reanimated UI runtime | scrim opacity, translateY, scale, opacity | per frame |
| 9 | native raster of transformed subtree | UI / render thread | copy bubble, pill, menu | per frame |

Two facts that matter for the diagnosis:

- **The copy is a real `MessageBubble`,** not a bitmap
  (`message-bubble-preview.tsx:18-56`): same markup, same `AttachmentGrid`,
  same `MusicBubble`, same `Text` content.
- **The copy is committed before the live bubble is hidden**: `hiddenKey` is set
  in a passive `useEffect`, which runs after the commit (and in RN typically
  after the frame is drawn), so there is at least one frame in which both the
  copy and the live bubble occupy the same rect.

## 3. The animation

Four shared values, all created in the provider (`context-popup.tsx:198-209`):

| Clock | Drives | Open | Close |
| --- | --- | --- | --- |
| `progress` | scrim opacity, copy `translateY`, pill/menu opacity | `withTiming(1, 220 ms, Easing.out(cubic))` (`383-386`) | `withTiming(0, 160 ms)` (`291-300`) |
| `pop` | reaction pill `scale` + `translateY` | `withSpring(1, {damping:14, stiffness:260, mass:0.7})` (`374`) | timing 0 |
| `menuPop` | action menu `scale` + `translateY` | same spring, `withDelay(30)` (`375-378`) | timing 0 |
| `copyPop` | copy bubble `scale` `1 -> 1.035` | `withSpring(1, {damping:11, stiffness:240, mass:0.7})` (`381`) | timing 0 |

Properties actually animated — CONFIRMED, verified by reading every
`useAnimatedStyle` in the file:

| Property | Where | Layout-forcing? | Android cost |
| --- | --- | --- | --- |
| `opacity` | scrim `591-593`, pill `714-719`, menu `774-779`, center `836` | no | cheap (alpha layer) |
| `transform: translateY` | copy `657-663`, pill `723-728`, menu `783-792` | no | cheap |
| `transform: scale` | copy `666-672`, pill `731-737`, menu `796-801`, center `839-845` | no | re-rasterizes the scaled subtree every frame |
| `transformOrigin` | copy `683`, pill/menu `745`/`811` | no | supported by RN 0.88 |

Not animated anywhere in the popup: `height`, `width`, `top`, `left`, `margin`,
`padding`, `borderRadius`, shadow, elevation, blur. **So no animation in this
path forces a layout pass — good, and it rules out "animating layout props" as
the cause.**

Notable findings in this area:

1. **The copy has no opacity animation at all** (`context-popup.tsx:646-675`).
   It is invisible-to-visible in a single frame at `progress = 0`, exactly when
   the live bubble is replaced. This is a deliberate design ("the same element
   appears to lift"), but it makes the swap frame the most expensive and the
   most visible one.
2. **The spring scales the entire bubble subtree** (`665-672`), including text,
   `expo-image` views and clipped attachment tiles. Every frame the copy's
   native subtree is re-rasterized at a new scale; text is re-rendered at
   fractional scales. There is no `renderToHardwareTextureAndroid` and no
   `shouldRasterizeIOS` anywhere in the popup (grep over `mobile/src` returns
   none).
3. **The copy's `translateY` and `scale` are on the same view** (`679-685`):
   `[absoluteRect(rect), {transformOrigin}, animatedStyle]`. Two independent
   clocks write into one transform array, so both are recomputed on every frame
   of either clock.
4. Worklets read shared values only (`hiddenKey.value`, `progress.value`, ...).
   No worklet in the popup reads React state — CONFIRMED, so "worklet reads
   React state" is not the problem.
5. One `scheduleOnRN` exists, but only in the **close completion** callback
   (`context-popup.tsx:294-299` -> `revealSource`). Nothing is dispatched to JS
   per frame on open. `runOnJS` is not used.
6. `usePopupHidden` is instantiated by **every** bubble, including the copy
   (`message-bubble.tsx:194`), so each visible row has one extra
   `useAnimatedStyle` that compares `hiddenKey.value === key`. That is cheap per
   row, but it means opening a popup touches one animated style per visible
   message on the UI runtime.

## 4. Re-render audit

What renders when `setSession(next)` runs (open):

| Component | Re-renders? | Evidence |
| --- | --- | --- |
| `ContextPopupProvider` | yes, once per open and once per close | `context-popup.tsx:210`, `349` |
| Navigator / screens / `FlatList` | **no** | `children` is passed as a prop from `app/_layout.tsx:165-181`; that element is created by `AppTree`, which does not re-render on popup state, so React bails out on the same element reference |
| Message rows | **no** | consequence of the row above; also `renderItem`/`keyExtractor` are stable (`[chatId].tsx:1946-1968`) |
| `PopupBackdrop` | mounts once, memoized | `584` |
| `MessageBubblePreview` | mounts (new instance) | rendered into `config.preview` at `[chatId].tsx:1575-1586` |
| `MessageBubble` (the copy) | mounts, and runs its whole body | `message-bubble-preview.tsx:41-53` |
| `ContextMenuCard`, `ReactionPill` | mount | `context-popup.tsx:542-570` |

So the "whole list re-renders on open" concern is **not** the cause: the popup
host is above the navigator and never re-renders it. The cost on open is a
**mount**, not a re-render: one full `MessageBubble` plus every child it renders.

Offenders and risks that still matter:

| # | Item | File:line | Why it matters |
| --- | --- | --- | --- |
| 1 | Copy mounts the full bubble component tree | `message-bubble-preview.tsx:41-53` | text parsing (`contentSegments` `useMemo`), attachment filtering, `useAudioDownload`, `useUploadProgress`, `expo-image`, SVG icons, `usePopupHidden` |
| 2 | Copy adds/removes content vs the live row | `[chatId].tsx:1581-1582` vs `2164-2165` | causes a visible change at the swap frame and extra text layout inside a fixed-height box (`message-bubble-preview.tsx:40`) |
| 3 | `MessageBubble` is not memoized | `message-bubble.tsx:140` (`export function`, no `memo`) | every list re-render re-renders every visible bubble. This does not happen on open, but it does happen if the screen re-renders while the popup animates (socket/typing/seen) |
| 4 | `openMessageMenu` is a new function every screen render | `[chatId].tsx:1622` | passed as `onOpenMenu` to every row; combined with #3, a screen re-render rebuilds every row's callbacks |
| 5 | `renderRow` closure is recreated each screen render | `[chatId].tsx:2114-2260` | stored in `rowRendererRef` (`2261`), so FlatList keeps a stable `renderItem`; rows still re-render when `data` identity changes |
| 6 | `reversedListData = [...listData].reverse()` | `[chatId].tsx:489-491` | new array whenever `listData` changes (new message, edit, reaction, seen) -> FlatList re-renders visible cells |
| 7 | `musicQueue` array prop identity | `[chatId].tsx:2162`, `message-bubble.tsx:112` | if the queue array is rebuilt on render, all bubbles receive a new prop |
| 8 | `listExtraData` string includes the whole selection set | `[chatId].tsx:1968-1971` | unrelated to the popup, but a selection change re-renders all cells |
| 9 | Per-tile store subscription in the copy | `attachment-grid.tsx:137` (`useUploadProgress`) | one extra subscription per attachment while an upload runs |

Confirmed non-issues on this path: `useMemo` for the controller
(`context-popup.tsx:415-422`), memoized `PopupBackdrop`/`PopupPreview`/
`PopupMenu`/`PopupReactions`/`ContextMenuCard`/`ReactionPill`, stable
`PopupHiddenContext` value (the shared value itself), memoized
`menuItems`/`reactionItems` (`436-455`).

## 5. Measuring / layout cost on the open path

1. **One async hop exists and it is on the critical path.** The popup cannot be
   laid out until a native `measureInWindow` round-trip resolves (CONFIRMED):

```ts
// mobile/src/features/messages/message-bubble.tsx:194-206
    const hiddenStyle = usePopupHidden(message.key);

    const openMenu = useCallback((): void => {
        if (onOpenMenu === undefined) {
            return;
        }
        void measureInWindow(bubbleRef).then((anchor): void => {
            if (anchor === null) {
                return;
            }
            onOpenMenu(message, anchor);
        });
    }, [message, onOpenMenu]);
```

```ts
// mobile/src/shared/context-popup/measure.ts:13-27
export function measureInWindow(
    ref: RefObject<ViewInstance | null>,
): Promise<PopupRect | null> {
    return new Promise((resolve) => {
        const node = ref.current;
        ...
        node.measureInWindow((x, y, width, height): void => {
```

   How many frames this costs on Expo Go/Android is **NOT VERIFIED** (no trace
   run). It is at least one native round trip plus a promise microtask.

2. **No `onLayout` wait.** The layout is pure math over fixed chrome sizes
   (`popup-layout.ts:115-236`), and `previewHeight` is forced to the anchor's
   height (`177-183`). There is no second frame where the popup is empty or
   half-sized — CONFIRMED.
3. **The copy's content is never measured, only the anchor box is.** The wrapper
   is given the anchor's width/height (`message-bubble-preview.tsx:40`,
   `message-bubble.tsx:1128-1135`). If the copy's own content is taller than the
   live bubble (which happens when `showSenderName` differs, section 4 #2), the
   content silently overflows the fixed box instead of resizing it.
4. **Keyboard height is read from a ref synchronously** and used only for the
   bottom clamp (`context-popup.tsx:227-240`, `popup-layout.ts:122-129`). No
   `Keyboard` event can occur between the press and the animation unless the IME
   is already animating.
5. **No `setTimeout`/`InteractionManager` between the press and the first
   animation frame**, apart from the promise above. The only `requestAnimationFrame`
   on this path is on close (`context-popup.tsx:270`).
6. **One measurement of a Reanimated view per long press.** The measured node has
   `collapsable={false}` (`message-bubble.tsx:315`), so the native view exists,
   but it is a Reanimated `Animated.View` participating in an animated style —
   a native measure on it is a normal `measureInWindow`, not a synchronous read
   (HYPOTHESIS that it is any slower than a plain `View`; verifiable by
   measuring a static sibling instead).

## 6. The live bubble vs the copy

- **The copy is the same component.** `MessageBubblePreview` renders
  `MessageBubble` with `isStatic` (`message-bubble-preview.tsx:18-56`), so the
  copy contains images, video posters, music covers, reply preview, reactions,
  meta/ticks, etc. — everything the live bubble contains.
- **It is mounted fresh, not reused.** Nothing is shared between the live row's
  React tree and the copy's tree: new `expo-image` instances, new SVG icons, new
  `Text` nodes, new `Pressable`s (disabled by a `pointerEvents="none"` wrapper,
  `message-bubble-preview.tsx:40`).
- **Images are re-requested through the cache, not the network.**
  `cachePolicy="memory-disk"` with an explicit `cacheKey` per attachment
  (`attachment-grid.tsx:192-197`) means the bytes normally come from the memory
  cache. HYPOTHESIS: no network fetch, but a **new Image instance still runs its
  `transition` fade-in** from transparent, because `transition={150}` is set
  with no `placeholder` (`attachment-grid.tsx:198`). Verify by temporarily
  setting `transition={0}` and comparing.
- **Video copies are heavier than image copies.** The poster surface is mounted
  again with `blurRadius={blur}` (`video-poster.tsx:147`) — an image-wide blur —
  and `transition={sharp ? 220 : 0}` (`148`). The shimmer loop is disabled for
  the copy (`live={!isStatic}`, `attachment-grid.tsx:180-184`) and the downloader is
  not subscribed (`live:false` path in `video-downloader.ts:1046-1091`), so the
  copy does not start a download — CONFIRMED.
- **Music copies load a cover with a fade.** `transition={120}`
  (`music-bubble.tsx:194-199`), and `useAudioDownload` subscribes but does not
  start anything (`audio-downloader.ts:178-213`). The scrub line is not rendered
  for the copy (`active = !isStatic && isActiveTrack`, `music-bubble.tsx:96`, `246`).
- **The live bubble is hidden with opacity only.** `usePopupHidden` returns
  `{ opacity: hiddenKey.value === key ? 0 : 1 }` (`context-popup.tsx:159-168`)
  and it is applied to the bubble's own `Reanimated.View`, not a wrapper
  (`message-bubble.tsx:311-323`). No layout prop changes; the row stays mounted
  and keeps its size. CONFIRMED.
- **The live bubble is in a pressed state at the moment of the swap.** The
  outer `Pressable` applies `styles.pressed` (opacity 0.6) while held
  (`message-bubble.tsx:752-754`, style at `1158`), and the finger is still down
  when the popup opens. The copy is at opacity 1. So the bubble jumps from 60%
  to 100% opacity in the frame where the copy lands on it.

## 7. List interaction

`FlatList` props as configured (`[chatId].tsx:2394-2489`):

| Prop | Value | Note |
| --- | --- | --- |
| `inverted` | `true` | `2396` |
| `keyExtractor` | `m-<key>` / `u-<key>` / `d-<key>` | `2400-2409`, stable callback |
| `renderItem` | stable `useCallback` reading a ref | `1954-1958`, `2488` |
| `extraData` | `selecting:selectedIds` string | `1968-1971`, `2487` |
| `data` | `reversedListData` (new array on any list change) | `489-491`, `2486` |
| `removeClippedSubviews` | not set | Android default is `true` |
| `windowSize` | not set | default 21 |
| `initialNumToRender` | not set | default 10 |
| `maxToRenderPerBatch` | not set | default 10 |
| `getItemLayout` | not set | variable-height rows, so windowing must measure |
| `scrollEventThrottle` | `16` | `2434`, `onScroll` runs JS work ~60/s while scrolling |
| `onViewableItemsChanged` | stable ref | `623-...`, `2428`; feeds read-receipt marking |
| `onEndReached` | `conversation.loadOlder()` | pagination can fire while a popup is open |

Can things change under the popup while it animates?

- **New messages**: yes. `sendMessage:list`, `editMessage:list`,
  `deleteMessage:list`, `reaction:updated`, `seen` are all subscribed in
  `use-chat-messages.ts:740-747`, so the list can re-render at any moment,
  including during the 220 ms open or the 160 ms close.
- **Auto-scroll to newest**: the screen keeps scroll state and a
  "scroll to latest" controller; there is no check for an open popup, so a new
  message can scroll the list while the copy is lifted. The copy stays at the
  old window rect, so the illusion breaks (also a correctness bug, not only
  perf).
- **Typing indicator**: `useTypingUsers` re-renders the screen header, not the
  rows, but it does fire `setState` from socket events and every 1000 ms from a
  sweeper (`use-typing-users.ts:16`, `145-162`).
- **Seen updates**: `use-mark-seen.ts` schedules `setTimeout` -> `setTick`
  (`62-90`), which re-renders `ChatDetail` and can land in the animation window.
- **Read receipts of visible rows**: `onViewableItemsChanged` fires on any
  scroll, including programmatic ones.

## 8. Blocking work that can run during the animation

| Work | Rate | File:line |
| --- | --- | --- |
| Typing-state sweeper (`setInterval`) | every 1000 ms while the chat is enabled | `features/messages/use-typing-users.ts:16`, `145-162` |
| `typing:start` / `typing:stop` / `sendMessage:list` socket handlers | on every event | `use-typing-users.ts:136-139` |
| New/edit/delete/pin/reaction/seen socket handlers | on every event | `use-chat-messages.ts:740-747` |
| Mark-seen timers -> `setTick` -> screen re-render | per read target | `use-mark-seen.ts:62-90` |
| Video download progress flush | throttled to 100 ms per active download | `shared/media-cache/video-downloader.ts:77`, `206-208` |
| Audio download progress | throttled to 100 ms | `shared/media-cache/audio-downloader.ts:58`, `292` |
| Music position frame clock | every frame (UI thread only) | `shared/music-player/music-player-provider.tsx:47` (`useFrameCallback`) |
| Music time label -> `setSeconds` | at most once per second | `shared/music-player/music-time-label.tsx:29-35` |
| Mini-player shimmer/rotation loops | continuous `withRepeat` while the bar is shown | `shared/music-player/mini-player-bar.tsx:84`, `136` |
| Video tile "breathe" loop / queued ring spin | continuous while a video tile is idle/queued and live | `features/attachments/video-download-control.tsx:103-121`, `340-356` |
| SQLite / media-cache writes | event-driven (downloads, send, reactions) | `features/messages/use-chat-messages.ts` (send/ack path), `shared/media-cache/*` |

No periodic timer is started by the popup itself. Nothing in the popup path does
file I/O or network I/O synchronously, and the copy's video surface is
`live:false` so it does not start a download.

## 9. Expo Go / Android specifics

| Technique | Used here? | Where |
| --- | --- | --- |
| `elevation` on the full-screen overlay | yes, `1000` (plus `zIndex`) | `context-popup.tsx:856-865` |
| `elevation` + shadow on the animated menu card | yes, `elevation: 10`, `shadowRadius: 14`, `overflow: 'hidden'`, `borderRadius: 15` | `shared/context-popup/menu-card.tsx:91-102`, shadow preset `shared/theme/design-token.ts:150-156` |
| `elevation` + shadow on the animated pill | yes, `elevation: 9`, `shadowRadius: 12`, `borderRadius: full`, `overflow: 'hidden'` | `shared/context-popup/reaction-pill.tsx:58-74` |
| Animated `scale` on views with elevation + `overflow: hidden` clipping | yes (menu and pill) | `context-popup.tsx:796-813`, styles above |
| `BlurView` (expo-blur) | **iOS only**, guarded by `Platform.OS === 'ios'` | `context-popup.tsx:599-609` — so blur is NOT an Android cause |
| `Modal` in the popup path | no | popup is a plain overlay; `Modal` exists only for unrelated dialogs (`[chatId].tsx:2674` edit dialog, forward picker, sheets) |
| `LayoutAnimation` | no (grep over `mobile/src` returns none) | — |
| Reanimated entering/exiting layout animations | no (grep over `mobile/src` returns none) | — |
| Large `borderRadius` clipping with `overflow: 'hidden'` | yes, on attachment tiles and music cover | `attachment-grid.tsx:262-269`, `music-bubble.tsx:270-275` |
| `renderToHardwareTextureAndroid` / `shouldRasterizeIOS` | no | grep over `mobile/src` returns none |
| `MaskedView` around the list underneath the popup | yes | `shared/edge-fade/edge-fade-view.tsx:96-118` (`@react-native-masked-view/masked-view`) |

Why the `MaskedView` matters: the message list is wrapped in a masked view for
the edge fades, and the popup overlay is composited above it. Any full-screen
alpha/elevation layer over a masked subtree can force the compositor to treat
the layer below as an offscreen buffer on Android. HYPOTHESIS; verify by
temporarily replacing `EdgeFadeView` with a plain `View` (see section 12 B7).

## 10. History of attempts

From comments, READMEs and git history (read-only; `git log --oneline`,
`git show --stat`):

- The popup was redesigned from per-screen menus to one app-level host. Commit
  `aa5d5bf` is literally titled `wip: snapshot before context popup redesign`
  and touched every screen to adopt it (2026-11-13).
- The old sheet-based files are gone: `features/messages/message-reactions-sheet.tsx`
  and `features/chats/chat-context-menu.tsx` were renamed/removed; the reactor
  list survives as `features/messages/message-reactions-popup.tsx` and is now
  passed as `center.content` (`[chatId].tsx:1644-1660`). That file still uses a
  plain `ScrollView` + `useEffect` fetch; it is not part of the message-menu path.
- The current design decisions are documented as deliberate fixes in
  `shared/context-popup/README.md` and in the 49-66 comment block of
  `context-popup.tsx`:
  - "no `Modal`" (`README.md:9-11`),
  - "no measurement, no wait" (`README.md:12-16` — contradicted below),
  - "the list is never re-rendered" (`README.md:17-21`),
  - two clocks, no per-frame React state (`README.md:22-28`),
  - Android deliberately has no blur because "a `Modal`-less overlay can still
    not blur another window on Android in Expo Go" (`README.md:141-148`).
- `EdgeFadeView` documents an earlier failure mode in its own comment: swapping
  between a plain `View` and `MaskedView` remounted the whole list
  (`edge-fade-view.tsx:47-54`). That attempt is gone; the current version always
  renders the `MaskedView`.
- **Documentation drift worth knowing:**
  - `README.md:12` claims "No measurement, no wait", but the actual open path is
    gated on `measureInWindow` (`message-bubble.tsx:196-206`).
  - `features/messages/README.md:61-66` still says "The bubble in the list is
    never hidden or re-rendered", while the code now hides it via
    `usePopupHidden` (`message-bubble.tsx:194`, `311-323`).
  - `popup-layout.ts:41` declares `PopupPlacement = 'below'` only, yet the
    host still carries both `originTop` and `originBottom` branches
    (`context-popup.tsx:745`, `811`) — dead branch.
- No commit in the available history claims a performance fix for this popup;
  there is no benchmark, perf note or TODO/FIXME about it in the tree (grep for
  `TODO|FIXME` in the popup path returns nothing).
- Uncommitted working-tree changes exist in `message-bubble.tsx` (mentions
  feature + `setPressedMentionIndex` state, see section 5 note) and in
  `[chatId].tsx`; they are unrelated to the popup animation, but they do add a
  per-row `useState` and inline `onPressIn/onPressOut` handlers on mention
  `<Text>` nodes (`message-bubble.tsx:563-600`), which makes a bubble with
  mentions heavier to render.

## 11. Ranked hypotheses

Ranked by (code evidence strength x expected share of the symptom). All fixes
are described in one sentence; no code is proposed here.

| Rank | Hypothesis | Evidence | Verify in <10 min | Fix if confirmed (one sentence) |
| --- | --- | --- | --- | --- |
| 1 | The copy is mounted as a full live bubble at the same commit that starts the animation, so the first frame carries text layout + image/poster mounting, and the image fades in with `transition` while the live bubble is already hidden — the perceived "snap + stutter", worst for images/video | `message-bubble-preview.tsx:41-53`; `attachment-grid.tsx:187-201` (`transition={150}`, no `placeholder`); `video-poster.tsx:138-149` (`blurRadius`, `transition` 220); `context-popup.tsx:357-368` | In `attachment-grid.tsx` set `transition={0}` and temporarily set `blurRadius={0}` for posters; open the popup on a large image and a video 5 times each, note Perf Monitor UI FPS | Render a cheap stand-in (or a cached thumbnail) as the copy's first frame and swap to the real bubble after the open animation. |
| 2 | The spring scale over a full bubble subtree (text + images) re-rasterizes the copy every frame on Android, with no hardware layer | `context-popup.tsx:665-672` (scale), `679-685` (single view), no `renderToHardwareTextureAndroid` anywhere | Set `COPY_POP_SCALE_TO` to `1` / skip the `copyPop` clock (or replace the copy content with a gray `View`) and compare the open animation | Scale a pre-rasterized snapshot (or disable the copy scale) instead of the live subtree. |
| 3 | The copy's content differs from the live bubble (sender name added on run-continuation rows; avatar dropped), so the swap frame is a visible content change, and the extra line overflows the fixed-height copy box | `[chatId].tsx:1581-1582` vs `2164-2165`; `message-runs.ts:81-82`; `message-bubble-preview.tsx:40`; `message-bubble.tsx:790-795` (always-reserved 45 px avatar slot) | In a group chat, long-press the 1st and the 2nd message of one sender's run; compare the bubble before/after opening | Pass the row's real `showSenderName`/`showAvatar` (and `othersLastSeenId`) into the copy instead of recomputing them. |
| 4 | The popup starts only after an async `measureInWindow` round trip, so the animation begins late relative to the long-press | `message-bubble.tsx:196-206`; `measure.ts:13-41` | Add a temporary `console.log`/`performance.now()` around the press and the first `useEffect`, or log in `open()`; compare on device | Measure the bubble's rect when it is laid out (or cache it per row) so `open()` runs synchronously from the long press. |
| 5 | The swap frame double-paints: the copy is opaque at `progress = 0` while the live bubble is still visible (and at `pressed` 0.6 opacity) until a passive effect hides it | `context-popup.tsx:646-689` (no opacity), `357-368` (hide in `useEffect`); `message-bubble.tsx:752-754` + `1158` (0.6 while pressed) | Use React DevTools' "highlight updates" or temporarily give the copy `opacity: progress` and set `hiddenKey` in a layout effect; watch the first 2 frames | Fade the copy's opacity in over the first ~60 ms of `progress` and set `hiddenKey` before paint. |
| 6 | Android cost of `elevation`/shadows on the animated menu card and pill, and of the full-screen elevated overlay above the masked list | `menu-card.tsx:91-102`; `reaction-pill.tsx:58-74`; `context-popup.tsx:856-865`; `edge-fade-view.tsx:96-118` | Remove `elevation`/shadow from `menu-card` + `reaction-pill` (keep background/border), then remove `elevation: 1000` from the overlay; compare both | Draw the popup chrome without per-frame elevation (static shadow layer or no shadow on Android) and drop `elevation` from the host. |
| 7 | JS-thread work lands inside the animation window (socket message/seen/typing, mark-seen timers, 100 ms download progress), re-rendering the screen and the visible rows (bubbles are not memoized) | `use-chat-messages.ts:740-747`; `use-typing-users.ts:16`, `145-162`; `use-mark-seen.ts:62-90`; `video-downloader.ts:77`; `message-bubble.tsx:140` (no `memo`) | Open the popup repeatedly in a busy group chat vs. a quiet private chat; or pause the socket and repeat | Freeze/defer list updates while a popup is open, and memoize the bubble rows. |
| 8 | The copy rebuilds too much unrelated work: content parsing, attachment filters, per-tile store subscriptions, an extra `usePopupHidden` animated style | `message-bubble.tsx:194`, `249-266` (parse), `278-293` (filters), `attachment-grid.tsx:137` | Render `<MessageBubblePreview>` with a hard-coded gray `View` instead of `MessageBubble` and compare | Give the copy a precomputed, minimal snapshot model instead of re-running the full bubble body. |

Order of experiments for a fast diagnosis: 1 (transition/blur off) -> 2 (copy
content replaced by a rectangle) -> 3 (group run-continuation message) -> 4
(timing log) -> 6 (strip elevation).

## 12. Minimal reproduction and measurement plan

### Reproduction

1. Install/open the app in Expo Go on Android (not a dev build), release-mode JS
   is not available in Expo Go — dev mode is what the user is testing.
2. Use a **group chat** (so sender runs and avatars exist) with at least:
   - one message with a single large image (portrait, so height is 320),
   - one message with 4 images (2x2 grid),
   - one message with a video attachment (poster state "ready" and "idle"),
   - one music attachment,
   - one long text message (>10 lines),
   - two consecutive messages from the same sender (run start + run
     continuation).
3. Open the popup 5 times on each: tap once (note: a plain tap also opens the
   menu, `message-bubble.tsx:225-237`) and once with a 350 ms+ long press.
4. Repeat each case with the keyboard closed and with it open (focus the composer
   first) — this is the requested scenario matrix; it is unmeasured here.
5. Repeat on the newest message and on a message near the top of history.

### Measurement

- **Perf Monitor** (Dev Menu -> Perf Monitor): watch both JS and UI FPS during
  open and close. Record whether JS FPS or UI FPS drops — that separates rank 7
  from ranks 1/2/6.
- **React DevTools Profiler** (connected to Expo Go): record one open + close;
  confirm that no message row re-renders (expected per section 4) and that the
  only commit of interest is the provider's. If rows do re-render, rank 7 is
  confirmed.
- **Chrome trace / `adb`**: if available, `adb shell dumpsys gfxinfo <package>
  framestats` around a popup open; `adb shell dumpsys SurfaceFlinger --latency`
  is usually not usable in Expo Go because the surface belongs to the Expo Go
  process and the app is not the top activity owner. Mark as NOT VERIFIED here —
  no capture was taken.
- **Timing the async hop** (rank 4): temporary `console.log` of
  `Date.now()` at `onLongPress` and at the first line of the entrance
  `useEffect`; the delta includes the measure round trip and the commit. Remove
  afterwards; this investigation did not add any logging.

### A/B checklist (each is a one-line toggle)

| ID | Toggle | What it isolates |
| --- | --- | --- |
| B1 | `attachment-grid.tsx`: `transition={150}` -> `transition={0}` | copy image cross-fade |
| B2 | `video-poster.tsx`: `blurRadius={blur}` -> `blurRadius={0}` | poster blur cost |
| B3 | `message-bubble-preview.tsx`: replace `<MessageBubble .../>` with a gray `View` | full copy mount cost |
| B4 | `context-popup.tsx`: `copyPop.value = withSpring(1, ...)` -> no-op | spring scale of the copy |
| B5 | `context-popup.tsx`: `POPUP_SCRIM_OPACITY` -> `0` | scrim/compositing cost |
| B6 | `menu-card.tsx` + `reaction-pill.tsx`: delete `...shadows.floating`, `elevation`, `overflow: 'hidden'` | elevation/shadow/clip on animated chrome |
| B7 | `context-popup.tsx` overlay: remove `elevation: 1000`, keep `zIndex` | full-screen elevated layer |
| B8 | `edge-fade-view.tsx`: return `<View>{children}</View>` before the `MaskedView` branch | masked list compositing |
| B9 | `message-bubble.tsx`: hide the live bubble with opacity only (already the case) vs. also disable `styles.pressed` for long press | pressed-opacity mismatch |
| B10 | `use-chat-messages.ts`: disable socket subscriptions temporarily | JS-thread interference |
| B11 | Add `renderToHardwareTextureAndroid` to the copy's `Animated.View` (`context-popup.tsx:679`) | confirms the re-raster hypothesis if it improves |

## 13. File map

| Path | Role | ~Lines | Look at first |
| --- | --- | --- | --- |
| `mobile/src/shared/context-popup/context-popup.tsx` | Host: state, 4 clocks, entrance/exit, overlay, scrim, copy wrapper, pill/menu wrappers | 870 | `309-387` (open + entrance), `584-690` (backdrop + copy), `856-870` (overlay elevation) |
| `mobile/src/shared/context-popup/popup-layout.ts` | Pure geometry; fixed chrome sizes; no measurement | 236 | `177-205` (copy keeps anchor box, stack shift), `41` (dead `placement` type) |
| `mobile/src/shared/context-popup/measure.ts` | `measureInWindow` promise wrapper | 41 | whole file |
| `mobile/src/shared/context-popup/menu-card.tsx` | Action menu card, memoized | 136 | `91-102` (elevation/shadow/overflow) |
| `mobile/src/shared/context-popup/reaction-pill.tsx` | Quick-reaction pill, memoized | 89 | `58-74` (elevation/shadow/overflow) |
| `mobile/src/shared/context-popup/README.md` | Design notes + drift vs. code | 148 | `12-16`, `17-21`, `141-148` |
| `mobile/src/shared/context-popup/popup-layout.spec.ts` | Layout unit tests | 358 | geometry invariants |
| `mobile/src/features/messages/message-bubble.tsx` | Live bubble + menu trigger + `usePopupHidden` + all bubble content | 1374 | `194-206` (measure), `311-323` (opacity-only hide), `725-755` (Pressable/long press), `783-835` (group avatar slot) |
| `mobile/src/features/messages/message-bubble-preview.tsx` | The copy: same `MessageBubble` with `isStatic` and fixed box | 60 | `18-56` |
| `mobile/src/features/messages/message-menu.tsx` | Menu data (actions -> rows) | 179 | `60-139` |
| `mobile/src/features/messages/message-actions.ts` | Which actions exist per message | 92 | used by `buildMessageMenuConfig` |
| `mobile/src/features/messages/message-runs.ts` | `showSenderName` / `showAvatar` per row | 85 | `81-82` |
| `mobile/src/features/attachments/attachment-grid.tsx` | Image/video tiles in the bubble and in the copy | 345 | `117-215` (tile, Image, `transition`), `262-269` (clip) |
| `mobile/src/features/attachments/video-poster.tsx` | Video poster (blur + shimmer + fade) | 345 | `138-149` (blur/transition), `164-185` (shimmer) |
| `mobile/src/features/attachments/video-download-control.tsx` | Ring/progress/breathe/spin animations | 717 | `103-121`, `340-356` |
| `mobile/src/features/music/music-bubble.tsx` | Music bubble (cover `Image`, fixed card) | ~320 | `191-199` (cover transition), `246` (scrub line) |
| `mobile/src/features/messages/message-reactions-popup.tsx` | Centered reactor list (not the menu) | 221 | `28-60` (fetch on mount) |
| `mobile/src/app/(app)/chat/[chatId].tsx` | Screen: list, renderItem, config builder, preview props | 3034 | `1526-1591` (config + copy), `1622-1627` (open), `1946-1969` (stable list identity), `2130-2261` (row -> bubble props), `2394-2489` (FlatList) |
| `mobile/src/app/_layout.tsx` | Mounts the popup host above the navigator | ~200 | `161-181` |
| `mobile/src/shared/edge-fade/edge-fade-view.tsx` | `MaskedView` around the list | 120 | `96-118` |
| `mobile/src/shared/theme/design-token.ts` | Shadow presets used by popup chrome | ~180 | `150-156` |
| `mobile/src/features/messages/use-chat-messages.ts` | List state + socket events | 1790 | `740-747` (subscriptions) |
| `mobile/src/features/messages/use-typing-users.ts` | Typing state + 1 s sweeper | 172 | `16`, `145-162` |
| `mobile/src/features/messages/use-mark-seen.ts` | Read marking timers | 113 | `62-90` |
| `mobile/src/shared/music-player/music-player-provider.tsx` | Frame clock for playback position | ~130 | `47` |
| `mobile/src/shared/music-player/music-time-label.tsx` | Per-second `setSeconds` leaf | 60 | `29-35` |
| `mobile/src/shared/media-cache/video-downloader.ts` | Download progress throttle, `live` flag | ~1090 | `77`, `1046-1091` |
| `mobile/src/shared/media-cache/audio-downloader.ts` | Audio download store + `useAudioDownload` | ~300 | `58`, `178-213` |
