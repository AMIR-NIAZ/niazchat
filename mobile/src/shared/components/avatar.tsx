import { StyleSheet, View } from 'react-native';
import { UserAvatar } from './user-avatar';
import type { UserAvatarProps } from './user-avatar';
import { palette } from '../theme';

interface AvatarProps extends UserAvatarProps {
    /** Adds the lavender ring + soft purple glow used on hero avatars. */
    ring?: boolean;
    /** Ring inset in dp. Default: 2. */
    ringWidth?: number;
}

/**
 * Design-system avatar: the existing `expo-image` powered `UserAvatar`
 * (thumbnail requests, caching, initials fallback) wrapped with the brand ring.
 * All image/caching behaviour is intentionally left to `UserAvatar`.
 */
export function Avatar({
    ring = false,
    ringWidth = 2,
    size,
    borderRadius,
    ...rest
}: AvatarProps): React.ReactElement {
    if (!ring) {
        return (
            <UserAvatar
                size={size}
                {...(borderRadius !== undefined ? { borderRadius } : {})}
                {...rest}
            />
        );
    }
    const radius = (borderRadius ?? size / 2) + ringWidth + 3;
    return (
        <View
            style={[
                styles.ring,
                {
                    borderRadius: radius,
                    padding: ringWidth,
                    width: size + (ringWidth + 3) * 2,
                    height: size + (ringWidth + 3) * 2,
                },
            ]}
        >
            <UserAvatar
                size={size}
                {...(borderRadius !== undefined ? { borderRadius } : {})}
                {...rest}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    ring: {
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: palette.border.strong,
        backgroundColor: palette.glass.highlight,
        shadowColor: palette.primary[500],
        shadowOpacity: 0.45,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 6 },
        elevation: 6,
    },
});
