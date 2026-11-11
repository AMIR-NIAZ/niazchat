import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { palette, spacing, typography } from '../../shared/theme';
import { useSocketConnectionState } from './use-socket';

/**
 * Subtle "Reconnecting…" bar, shown only once the socket has been down for
 * more than three seconds so a normal reconnect blip stays silent. The banner
 * never blocks touches and disappears as soon as the socket is connected.
 */
export const RECONNECTING_DELAY_MS = 3000;

export function ReconnectingBanner(): React.ReactElement | null {
    const state = useSocketConnectionState();
    const insets = useSafeAreaInsets();
    const [visible, setVisible] = useState(false);

    useEffect((): (() => void) | undefined => {
        if (state === 'connected') {
            setVisible(false);
            return undefined;
        }
        if (visible) {
            return undefined;
        }
        const timer = setTimeout(
            (): void => setVisible(true),
            RECONNECTING_DELAY_MS,
        );
        return (): void => clearTimeout(timer);
    }, [state, visible]);

    if (!visible || state === 'connected') {
        return null;
    }

    return (
        <View
            pointerEvents="none"
            accessibilityLiveRegion="polite"
            style={[styles.banner, { paddingTop: insets.top + spacing.xxs }]}
        >
            <Text style={styles.text}>Reconnecting…</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    banner: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 100,
        alignItems: 'center',
        paddingBottom: spacing.xxs,
        backgroundColor: palette.semantic.warning,
    },
    text: {
        ...typography.caption,
        color: palette.neutral[0],
        fontWeight: '600',
    },
});
