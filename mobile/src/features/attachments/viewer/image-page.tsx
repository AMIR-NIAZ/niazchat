import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Pressable,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { Image } from 'expo-image';
import {
    GestureDetector,
    useCompetingGestures,
    useExclusiveGestures,
    usePanGesture,
    usePinchGesture,
    useSimultaneousGestures,
    useTapGesture,
} from 'react-native-gesture-handler';
import type {
    PanGestureConfig,
    PinchGestureConfig,
    TapGestureConfig,
} from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';
import Animated, {
    Easing,
    useAnimatedStyle,
    useSharedValue,
    withSpring,
    withTiming,
} from 'react-native-reanimated';
import { RotateCw } from 'lucide-react-native';
import { palette, radii, spacing } from '../../../shared/theme';
import { useReducedMotion } from '../../../shared/hooks/use-reduced-motion';
import { cacheImage, getCachedImageUri } from '../../../shared/media-cache';
import { attachmentPreviewUrl, attachmentUrl } from '../attachment-url';
import { useAttachmentAuth } from '../auth-headers';
import type { ViewerItem } from './viewer-model';

/**
 * One photo page of the viewer.
 *
 * - The bubble thumbnail is shown immediately (slightly blurred) and the full
 *   image cross-fades in (expo-image `transition`), preferring the local cached
 *   file over the network.
 * - Pinch (1x–5x), double-tap (1x ↔ 2.5x around the tapped point) and pan while
 *   zoomed (with rubber-band edges) all run as Reanimated worklets: no React
 *   state changes per frame. Only "is it zoomed" crosses back to JS, so the
 *   pager can lock, and unlocking happens as soon as the pan reaches an edge.
 */

const MIN_SCALE = 0.85;
const MAX_SCALE = 5;
const DOUBLE_TAP_SCALE = 2.5;
const ZOOMED_THRESHOLD = 1.05;
/** Horizontal breathing room that becomes the gap between two pages. */
const PAGE_INSET = 6;

interface ViewerImagePageProps {
    item: ViewerItem;
    active: boolean;
    width: number;
    height: number;
    onTap: () => void;
    /** True while the page is zoomed in (the pager is disabled). */
    onZoomChange: (zoomed: boolean) => void;
}

function clampValue(value: number, min: number, max: number): number {
    'worklet';
    return Math.min(max, Math.max(min, value));
}

/** Allows a little travel past the edge so the gesture feels elastic. */
function rubberBand(value: number, min: number, max: number): number {
    'worklet';
    if (value < min) return min + (value - min) * 0.35;
    if (value > max) return max + (value - max) * 0.35;
    return value;
}

export const ViewerImagePage = memo(function ViewerImagePage({
    item,
    active,
    width,
    height,
    onTap,
    onZoomChange,
}: ViewerImagePageProps): React.ReactElement {
    const { headers, refresh } = useAttachmentAuth();
    const reduceMotion = useReducedMotion();
    const attachment = item.attachment;
    const id = attachment.id;

    const [localUri, setLocalUri] = useState<string | null>(() =>
        getCachedImageUri(attachment),
    );
    const [loaded, setLoaded] = useState(false);
    const [failed, setFailed] = useState(false);
    const [slow, setSlow] = useState(false);
    const [refreshToken, setRefreshToken] = useState(0);
    const [zoomed, setZoomed] = useState(false);

    // Only the opened (and neighbour) pages fetch the full-size file.
    useEffect((): (() => void) | void => {
        if (!active) return;
        let cancelled = false;
        const ref = {
            id,
            mimeType: attachment.mimeType,
            name: attachment.name,
        };
        const cached = getCachedImageUri(ref);
        if (cached !== null) {
            setLocalUri(cached);
            return;
        }
        setLocalUri(null);
        void cacheImage(ref)
            .then((path): void => {
                if (!cancelled) setLocalUri(path);
            })
            .catch((): void => undefined);
        return (): void => {
            cancelled = true;
        };
    }, [active, id, attachment.mimeType, attachment.name]);

    // A spinner only appears when the full image takes noticeable time.
    useEffect((): (() => void) => {
        if (loaded || failed) return (): void => undefined;
        const timer = setTimeout((): void => setSlow(true), 300);
        return (): void => clearTimeout(timer);
    }, [loaded, failed, refreshToken]);

    const remoteUri =
        id !== null ? attachmentUrl(id) : (attachment.localUri ?? null);
    const uri = localUri ?? remoteUri;
    const thumbUri =
        id !== null ? attachmentPreviewUrl(id, 640) : attachment.localUri;

    const cacheKey = id !== null ? `att-${id}-full` : undefined;
    const fullSource =
        uri === null
            ? null
            : localUri !== null
              ? {
                    uri: localUri,
                    ...(cacheKey !== undefined ? { cacheKey } : {}),
                }
              : {
                    uri,
                    ...(cacheKey !== undefined ? { cacheKey } : {}),
                    ...(headers !== undefined ? { headers } : {}),
                };
    const thumbSource =
        thumbUri === undefined
            ? null
            : {
                  uri: thumbUri,
                  ...(headers !== undefined ? { headers } : {}),
              };

    // ── zoom state (UI thread) ──────────────────────────────────────────
    const scale = useSharedValue(1);
    const translateX = useSharedValue(0);
    const translateY = useSharedValue(0);
    const startScale = useSharedValue(1);
    const startX = useSharedValue(0);
    const startY = useSharedValue(0);

    const reportZoom = useCallback(
        (next: boolean): void => {
            setZoomed(next);
            onZoomChange(next);
        },
        [onZoomChange],
    );

    const reset = useCallback((): void => {
        'worklet';
        const duration = reduceMotion ? 90 : 180;
        scale.value = withTiming(1, {
            duration,
            easing: Easing.out(Easing.quad),
        });
        translateX.value = withTiming(0, { duration });
        translateY.value = withTiming(0, { duration });
    }, [reduceMotion, scale, translateX, translateY]);

    const pinch = usePinchGesture(
        useMemo<PinchGestureConfig>(
            () => ({
                onActivate: (): void => {
                    'worklet';
                    startScale.value = scale.value;
                },
                onUpdate: (event): void => {
                    'worklet';
                    scale.value = clampValue(
                        startScale.value * event.scale,
                        MIN_SCALE,
                        MAX_SCALE,
                    );
                },
                onDeactivate: (): void => {
                    'worklet';
                    if (scale.value < ZOOMED_THRESHOLD) {
                        reset();
                        scheduleOnRN(reportZoom, false);
                        return;
                    }
                    // Keep the image inside its own bounds after a pinch.
                    const maxX = (width * (scale.value - 1)) / 2;
                    const maxY = (height * (scale.value - 1)) / 2;
                    translateX.value = withTiming(
                        clampValue(translateX.value, -maxX, maxX),
                        { duration: 120 },
                    );
                    translateY.value = withTiming(
                        clampValue(translateY.value, -maxY, maxY),
                        { duration: 120 },
                    );
                    scheduleOnRN(reportZoom, true);
                },
            }),
            [
                height,
                reportZoom,
                reset,
                scale,
                startScale,
                translateX,
                translateY,
                width,
            ],
        ),
    );

    const doubleTap = useTapGesture(
        useMemo<TapGestureConfig>(
            () => ({
                numberOfTaps: 2,
                maxDuration: 280,
                onDeactivate: (event): void => {
                    'worklet';
                    if (scale.value > 1.2) {
                        reset();
                        scheduleOnRN(reportZoom, false);
                        return;
                    }
                    const target = DOUBLE_TAP_SCALE;
                    const duration = reduceMotion ? 90 : 220;
                    // Keep the tapped point under the finger.
                    scale.value = withTiming(target, {
                        duration,
                        easing: Easing.out(Easing.quad),
                    });
                    translateX.value = withTiming(
                        clampValue(
                            (width / 2 - event.x) * (target - 1),
                            -(width * (target - 1)) / 2,
                            (width * (target - 1)) / 2,
                        ),
                        { duration },
                    );
                    translateY.value = withTiming(
                        clampValue(
                            (height / 2 - event.y) * (target - 1),
                            -(height * (target - 1)) / 2,
                            (height * (target - 1)) / 2,
                        ),
                        { duration },
                    );
                    scheduleOnRN(reportZoom, true);
                },
            }),
            [
                height,
                reduceMotion,
                reportZoom,
                reset,
                scale,
                translateX,
                translateY,
                width,
            ],
        ),
    );

    const singleTap = useTapGesture(
        useMemo<TapGestureConfig>(
            () => ({
                numberOfTaps: 1,
                maxDistance: 12,
                onDeactivate: (): void => {
                    'worklet';
                    scheduleOnRN(onTap);
                },
            }),
            [onTap],
        ),
    );

    // Pan only while zoomed; it hands the pager back at the horizontal edge.
    const pan = usePanGesture(
        useMemo<PanGestureConfig>(
            () => ({
                maxPointers: 1,
                // Only while zoomed: at 1x the pager owns the drag.
                enabled: zoomed,
                onActivate: (): void => {
                    'worklet';
                    startX.value = translateX.value;
                    startY.value = translateY.value;
                },
                onUpdate: (event): void => {
                    'worklet';
                    if (scale.value <= ZOOMED_THRESHOLD) return;
                    const maxX = (width * (scale.value - 1)) / 2;
                    const maxY = (height * (scale.value - 1)) / 2;
                    translateX.value = rubberBand(
                        startX.value + event.translationX,
                        -maxX,
                        maxX,
                    );
                    translateY.value = rubberBand(
                        startY.value + event.translationY,
                        -maxY,
                        maxY,
                    );
                },
                onDeactivate: (): void => {
                    'worklet';
                    if (scale.value <= ZOOMED_THRESHOLD) return;
                    const maxX = (width * (scale.value - 1)) / 2;
                    const maxY = (height * (scale.value - 1)) / 2;
                    // Dragged past the horizontal edge: hand the swipe back to
                    // the pager instead of keeping the zoom. Nothing snaps the
                    // image back to the edge it was already resting on.
                    if (
                        translateX.value > maxX + 6 ||
                        translateX.value < -maxX - 6
                    ) {
                        reset();
                        scheduleOnRN(reportZoom, false);
                        return;
                    }
                    translateX.value = withSpring(
                        clampValue(translateX.value, -maxX, maxX),
                        { damping: 20, stiffness: 220 },
                    );
                    translateY.value = withSpring(
                        clampValue(translateY.value, -maxY, maxY),
                        { damping: 20, stiffness: 220 },
                    );
                },
            }),
            [
                height,
                reportZoom,
                reset,
                scale,
                startX,
                startY,
                translateX,
                translateY,
                width,
                zoomed,
            ],
        ),
    );

    const zoomGestures = useSimultaneousGestures(pinch, pan);
    const tapGestures = useExclusiveGestures(doubleTap, singleTap);
    const gesture = useCompetingGestures(zoomGestures, tapGestures);

    const mediaStyle = useAnimatedStyle(() => ({
        transform: [
            { translateX: translateX.value },
            { translateY: translateY.value },
            { scale: scale.value },
        ],
    }));

    return (
        <GestureDetector gesture={gesture}>
            <View
                style={[styles.page, { width, height }]}
                accessible={true}
                accessibilityRole="image"
                accessibilityLabel={`Photo ${item.message.senderName}, ${item.message.content ?? 'no caption'}`}
            >
                <Animated.View
                    style={[
                        styles.media,
                        {
                            width: width - PAGE_INSET * 2,
                            height,
                        },
                        mediaStyle,
                    ]}
                >
                    {thumbSource !== null && !loaded && (
                        <Image
                            source={thumbSource}
                            cachePolicy="memory-disk"
                            contentFit="contain"
                            blurRadius={8}
                            style={StyleSheet.absoluteFill}
                            pointerEvents="none"
                        />
                    )}
                    {fullSource !== null && (
                        <Image
                            key={`${uri ?? 'none'}-${refreshToken}`}
                            source={fullSource}
                            cachePolicy="memory-disk"
                            contentFit="contain"
                            transition={reduceMotion ? 90 : 200}
                            style={StyleSheet.absoluteFill}
                            onLoad={(): void => {
                                setLoaded(true);
                                setSlow(false);
                            }}
                            onError={(): void => {
                                if (localUri !== null) {
                                    setLocalUri(null);
                                    return;
                                }
                                setFailed(true);
                                void refresh();
                            }}
                        />
                    )}
                </Animated.View>

                {!loaded && !failed && slow && (
                    <View style={styles.center} pointerEvents="none">
                        <ActivityIndicator
                            size="small"
                            color={palette.primary[300]}
                        />
                    </View>
                )}
                {failed && (
                    <View style={styles.center}>
                        <Text style={styles.errorText}>
                            This photo could not be loaded.
                        </Text>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Retry loading the photo"
                            onPress={(): void => {
                                setFailed(false);
                                setLoaded(false);
                                setSlow(false);
                                setLocalUri(null);
                                setRefreshToken((value) => value + 1);
                            }}
                            hitSlop={8}
                            style={styles.retry}
                        >
                            <RotateCw
                                size={15}
                                color={palette.text.primary}
                                strokeWidth={2.2}
                            />
                            <Text style={styles.retryText}>Retry</Text>
                        </Pressable>
                    </View>
                )}
            </View>
        </GestureDetector>
    );
});

const styles = StyleSheet.create({
    page: {
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
    },
    media: { alignItems: 'center', justifyContent: 'center' },
    center: {
        position: 'absolute',
        top: 0,
        start: 0,
        end: 0,
        bottom: 0,
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.sm,
    },
    errorText: {
        color: palette.text.secondary,
        fontSize: 14,
        textAlign: 'center',
        paddingHorizontal: spacing.lg,
    },
    retry: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.xs,
        minHeight: 44,
        borderRadius: radii.full,
        backgroundColor: 'rgba(20, 10, 40, 0.7)',
        borderWidth: 1,
        borderColor: palette.border.strong,
    },
    retryText: {
        color: palette.text.primary,
        fontSize: 13,
        fontWeight: '600',
    },
});
