import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import {
    MORPH_DEFAULT_COLLAPSED_HEIGHT,
    MORPH_DEFAULT_COLLAPSED_WIDTH,
    MORPH_DEFAULT_NECK_RADIUS,
    morphGeometry,
} from './morphing-avatar-model';
import type { MorphGeometry } from './morphing-avatar-model';
import { UserAvatar } from './user-avatar';

/**
 * Profile avatar that morphs from a circle into a droplet attached to the top
 * edge of the scroll view, driven continuously by the scroll offset.
 *
 * How it stays glued to the top without an overlay: the avatar keeps its normal
 * place in the scroll content, and only the *painted* box is animated. A fixed
 * `expandedSize` slot holds the layout (so the content below never reflows
 * mid-scroll) while the clip box sits absolutely inside it; once the scroll
 * passes `topOffset` the downward translation grows as fast as the content
 * moves up, which pins the box to the top edge.
 *
 * The box stays a child of the ScrollView/FlatList on purpose — drags that
 * start on the avatar still scroll, because the avatar is content and not an
 * overlay above the list.
 *
 * The image itself never scales: it is a fixed `expandedSize` square, centred,
 * and only the clipping box (size + per-corner radii) changes, so the picture
 * is cropped by the morph, never stretched.
 */
export interface MorphingProfileAvatarProps {
    /** Animated scroll offset of the screen's ScrollView / FlatList. */
    scrollY: Animated.Value;
    /** Avatar's top offset inside the scroll content (where it pins). */
    topOffset: number;
    /** Expanded circular edge length in dp. */
    expandedSize: number;
    collapsedWidth?: number;
    collapsedHeight?: number;
    neckRadius?: number;
    /** Fallback color identity (user id, or chat id for groups). */
    userId: number;
    name: string;
    uri: string | null | undefined;
    /** Omitted when there is no photo to open. */
    onPress?: () => void;
    accessibilityLabel?: string;
}

function useAnimatedValue(initial: number): Animated.Value {
    const ref = useRef<Animated.Value | null>(null);
    if (ref.current === null) {
        ref.current = new Animated.Value(initial);
    }
    return ref.current;
}

export function MorphingProfileAvatar(
    props: MorphingProfileAvatarProps,
): React.ReactElement {
    const {
        scrollY,
        topOffset,
        expandedSize,
        userId,
        name,
        uri,
        onPress,
        accessibilityLabel,
    } = props;
    const collapsedWidth =
        props.collapsedWidth ?? MORPH_DEFAULT_COLLAPSED_WIDTH;
    const collapsedHeight =
        props.collapsedHeight ?? MORPH_DEFAULT_COLLAPSED_HEIGHT;
    const neckRadius = props.neckRadius ?? MORPH_DEFAULT_NECK_RADIUS;

    const initial: MorphGeometry = morphGeometry(0, {
        expandedSize,
        topOffset,
        collapsedWidth,
        collapsedHeight,
        neckRadius,
    });
    const width = useAnimatedValue(initial.width);
    const height = useAnimatedValue(initial.height);
    const translateY = useAnimatedValue(initial.translateY);
    const topLeft = useAnimatedValue(initial.borderTopLeftRadius);
    const topRight = useAnimatedValue(initial.borderTopRightRadius);
    const bottomLeft = useAnimatedValue(initial.borderBottomLeftRadius);
    const bottomRight = useAnimatedValue(initial.borderBottomRightRadius);

    useEffect((): (() => void) => {
        const apply = (offset: number): void => {
            const geometry = morphGeometry(offset, {
                expandedSize,
                topOffset,
                collapsedWidth,
                collapsedHeight,
                neckRadius,
            });
            width.setValue(geometry.width);
            height.setValue(geometry.height);
            translateY.setValue(geometry.translateY);
            topLeft.setValue(geometry.borderTopLeftRadius);
            topRight.setValue(geometry.borderTopRightRadius);
            bottomLeft.setValue(geometry.borderBottomLeftRadius);
            bottomRight.setValue(geometry.borderBottomRightRadius);
        };

        // The scroll listener only paints styles: no React re-render per frame.
        apply(0);
        const listenerId = scrollY.addListener(({ value }): void => {
            apply(value);
        });
        return (): void => {
            scrollY.removeListener(listenerId);
        };
    }, [
        scrollY,
        expandedSize,
        topOffset,
        collapsedWidth,
        collapsedHeight,
        neckRadius,
        width,
        height,
        translateY,
        topLeft,
        topRight,
        bottomLeft,
        bottomRight,
    ]);

    const picture = (
        <View style={styles.center}>
            <UserAvatar
                userId={userId}
                name={name}
                uri={uri}
                size={expandedSize}
            />
        </View>
    );

    return (
        <View style={[styles.slot, { width: expandedSize, height: expandedSize }]}>
            <View style={styles.pin} pointerEvents="box-none">
                <Animated.View
                    style={[
                        styles.clip,
                        {
                            width,
                            height,
                            transform: [{ translateY }],
                            borderTopLeftRadius: topLeft,
                            borderTopRightRadius: topRight,
                            borderBottomLeftRadius: bottomLeft,
                            borderBottomRightRadius: bottomRight,
                        },
                    ]}
                >
                    {onPress === undefined ? (
                        picture
                    ) : (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={
                                accessibilityLabel ?? `View photo of ${name}`
                            }
                            onPress={onPress}
                            style={({ pressed }) => [
                                styles.fill,
                                pressed && styles.pressed,
                            ]}
                        >
                            {picture}
                        </Pressable>
                    )}
                </Animated.View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    slot: {
        // Fixed layout box: the morph must never reflow the content below it.
        alignItems: 'center',
        zIndex: 1,
    },
    pin: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        alignItems: 'center',
    },
    clip: {
        overflow: 'hidden',
        backgroundColor: 'transparent',
    },
    fill: { flex: 1 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    pressed: { opacity: 0.6 },
});
