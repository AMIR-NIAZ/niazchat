import { StyleSheet, View } from 'react-native';
import type { StyleProp, ViewProps, ViewStyle } from 'react-native';
import { GlassSurface } from './glass-surface';
import type { GlassTone } from './glass-surface';
import { blur, radii, spacing } from '../theme';

interface GlassCardProps extends ViewProps {
    tone?: GlassTone;
    intensity?: number;
    radius?: number;
    /** Adds the soft purple elevation used by floating surfaces. */
    floating?: boolean;
    /** Default card padding. Set 0 for full-bleed content. */
    padding?: number;
    /** Style applied to the inner content view (layout/gap overrides). */
    contentStyle?: StyleProp<ViewStyle>;
}

/**
 * Rounded glass panel used for profile cards, settings groups and selected
 * elevated content. Readability comes from the translucent fill + subtle 1px
 * lavender border, never from transparency alone.
 */
export function GlassCard({
    tone = 'surface',
    intensity = blur.regular,
    radius = radii.lg,
    floating = false,
    padding = spacing.md,
    contentStyle,
    style,
    children,
    ...rest
}: GlassCardProps): React.ReactElement {
    return (
        <GlassSurface
            tone={tone}
            intensity={intensity}
            radius={radius}
            floating={floating}
            style={style}
            {...rest}
        >
            <View style={[styles.content, { padding }, contentStyle]}>
                {children}
            </View>
        </GlassSurface>
    );
}

const styles = StyleSheet.create({
    content: { gap: spacing.xs },
});
