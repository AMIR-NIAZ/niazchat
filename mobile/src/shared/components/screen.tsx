import { StyleSheet, View, ViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { palette, spacing } from '../theme';

/**
 * Full-height, safe-area-aware container used as the root of every screen.
 * Paints the almost-black canvas plus two soft purple ambient glows so the
 * glass surfaces have something atmospheric to refract. Layout is a shared
 * concern — features compose content inside it.
 */

interface ScreenProps extends ViewProps {
    /** Pad the content away from the status bar / notch. Default: true. */
    withTopInset?: boolean;
    withBottomInset?: boolean;
    /** Turn off the ambient purple glows (e.g. full-screen media viewers). */
    ambient?: boolean;
}

export function Screen({
    withTopInset = true,
    withBottomInset = true,
    ambient = true,
    style,
    children,
    ...rest
}: ScreenProps): React.ReactElement {
    const insets = useSafeAreaInsets();
    return (
        <View
            style={[
                styles.screen,
                {
                    paddingTop: withTopInset
                        ? insets.top + spacing.md
                        : undefined,
                },
                {
                    paddingBottom: withBottomInset
                        ? insets.bottom + spacing.md
                        : undefined,
                },
                style,
            ]}
            {...rest}
        >
            {ambient && (
                <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                    <View style={styles.glowTop} />
                    <View style={styles.glowBottom} />
                </View>
            )}
            {children}
        </View>
    );
}

const styles = StyleSheet.create({
    screen: {
        flex: 1,
        backgroundColor: palette.background,
        overflow: 'hidden',
    },
    glowTop: {
        position: 'absolute',
        top: -140,
        end: -110,
        width: 320,
        height: 320,
        borderRadius: 160,
        backgroundColor: 'rgba(117,69,184,0.22)',
    },
    glowBottom: {
        position: 'absolute',
        bottom: -180,
        start: -130,
        width: 360,
        height: 360,
        borderRadius: 180,
        backgroundColor: 'rgba(169,112,245,0.10)',
    },
});
