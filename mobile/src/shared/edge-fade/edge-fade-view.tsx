import { useCallback, useState } from 'react';
import { View } from 'react-native';
import type { LayoutChangeEvent, StyleProp, ViewStyle } from 'react-native';
import MaskedView from '@react-native-masked-view/masked-view';
import { LinearGradient } from 'expo-linear-gradient';
import { FILL_ABSOLUTE } from '../theme';
import { buildMaskStops } from './mask-stops';

/**
 * `@react-native-masked-view/masked-view` still ships React-18 class typings
 * (`React.Component<P>` without a context argument), which React 19's JSX
 * rejects. The component is a normal View-like host component at runtime, so
 * the cast only repairs the type surface.
 */
const MaskedViewSafe = MaskedView as unknown as React.ComponentType<{
    style?: StyleProp<ViewStyle>;
    maskElement?: React.ReactElement;
    children?: React.ReactNode;
}>;

/**
 * Extra height added on top of the measured chrome heights for the edge fades
 * (same constant as the message list in the chat screen).
 */
export const FADE_EXTRA = 100;

/** Shared fill for the mask layers: explicit, so it never depends on StyleSheet constants. */
const MASK_FILL: ViewStyle = { flex: 1 };

interface EdgeFadeViewProps {
    /** Height of the fade band at the top edge (px). */
    topFade: number;
    /** Height of the fade band at the bottom edge (px). */
    bottomFade: number;
    style?: StyleProp<ViewStyle>;
    children?: React.ReactNode;
}

/**
 * Soft fade of the wrapped content at its top and bottom edges.
 *
 * The root `View` carries the caller's style (typically an absolute fill) and
 * measures itself. The mask is an alpha gradient — transparent at the edges,
 * opaque in the middle — so the Screen's ambient background shows through the
 * faded strips.
 *
 * The wrapper's own markup NEVER changes shape: the children always sit under
 * the same host components, and an unmeasured container simply uses a fully
 * opaque mask. Swapping the wrapper between "plain View" and "MaskedView" (the
 * obvious first implementation) makes React destroy and recreate the whole
 * subtree on the first layout: the list remounts, its native scroll offset
 * resets to 0 and every cell is re-created — a guaranteed jump on open. With
 * `MaskedView` unavailable the children render unmasked, which is a static
 * fallback and cannot happen mid-session.
 */
export function EdgeFadeView(props: EdgeFadeViewProps): React.ReactElement {
    const [containerHeight, setContainerHeight] = useState(0);

    const onLayout = useCallback((event: LayoutChangeEvent): void => {
        const height = event.nativeEvent.layout.height;
        if (height <= 0) {
            return;
        }
        setContainerHeight((previous): number =>
            Math.abs(previous - height) < 0.5 ? previous : height,
        );
    }, []);

    // Recomputed on EVERY render, i.e. on every measured height (including the
    // list frame shrinking when the keyboard opens) and every fade change. An
    // unmeasured container yields a fully opaque mask, so the content is never
    // hidden while the numbers are still unknown.
    const mask = buildMaskStops(
        props.topFade,
        props.bottomFade,
        containerHeight,
    );
    // Re-created per measured height so the native mask view is rebuilt with the
    // new ramp instead of keeping a stale one.
    const maskKey = `edge-fade-${Math.round(containerHeight)}`;

    // Stable fallback (module constant): MaskedView missing is not a state the
    // app enters, it is a build-time absence.
    if (MaskedViewSafe === undefined) {
        return (
            <View style={props.style} onLayout={onLayout}>
                <View style={MASK_FILL} collapsable={false}>
                    {props.children}
                </View>
            </View>
        );
    }

    return (
        <View style={props.style} onLayout={onLayout}>
            <MaskedViewSafe
                style={MASK_FILL}
                maskElement={
                    <View key={maskKey} style={MASK_FILL} collapsable={false}>
                        <LinearGradient
                            colors={
                                mask.colors as [string, string, ...string[]]
                            }
                            locations={
                                mask.locations as [number, number, ...number[]]
                            }
                            start={{ x: 0.5, y: 0 }}
                            end={{ x: 0.5, y: 1 }}
                            style={FILL_ABSOLUTE}
                        />
                    </View>
                }
            >
                <View style={MASK_FILL} collapsable={false}>
                    {props.children}
                </View>
            </MaskedViewSafe>
        </View>
    );
}
