import { StyleSheet, View } from 'react-native';
import type { ViewProps } from 'react-native';
import { GlassSurface } from './glass-surface';
import { blur, radii, spacing } from '../theme';

interface GlassHeaderProps extends ViewProps {
    /** Content pinned to the start side (e.g. a back button). */
    leading?: React.ReactNode;
    /** Content pinned to the end side (e.g. actions). */
    trailing?: React.ReactNode;
    /** Adds the floating purple shadow. Default: true. */
    floating?: boolean; /** Full-bleed header attached to the screen edge (no rounding). */
    attached?: boolean;
    intensity?: number;
    /**
     * `stack` (default) stacks the center children (title + subtitle).
     * `row` lays them out horizontally (back button, identity, actions).
     */
    layout?: 'stack' | 'row';
}

/**
 * Floating glass header. Screens own their safe-area padding; this component
 * only paints the surface so it composes inside `Screen` without double insets.
 */
export function GlassHeader({
    leading,
    trailing,
    floating = true,
    attached = false,
    intensity = blur.strong,
    layout = 'stack',
    style,
    children,
    ...rest
}: GlassHeaderProps): React.ReactElement {
    return (
        <GlassSurface
            tone="header"
            intensity={intensity}
            radius={attached ? 0 : radii.lg}
            bordered={!attached}
            floating={floating}
            style={style}
            {...rest}
        >
            <View style={styles.row}>
                {leading !== undefined && (
                    <View style={styles.leading}>{leading}</View>
                )}
                <View
                    style={[
                        styles.center,
                        layout === 'row' && styles.centerRow,
                    ]}
                >
                    {children}
                </View>
                {trailing !== undefined && (
                    <View style={styles.trailing}>{trailing}</View>
                )}
            </View>
        </GlassSurface>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xs,
        minHeight: 56,
    },
    leading: { flexShrink: 0 },
    center: { flex: 1, minWidth: 0 },
    centerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
    },
    trailing: {
        flexShrink: 0,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xxs,
    },
});
