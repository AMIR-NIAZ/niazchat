import { StyleSheet, Text, View } from 'react-native';
import { useSocketConnectionState } from '../../core/socket/use-socket';
import { palette, spacing, typography } from '../theme';

/**
 * One-line, non-blocking notice shown while there is no backend connection and
 * the screen is rendering previously saved data. It disappears by itself once
 * the socket is back.
 */
export function OfflineCaption(): React.ReactElement | null {
    const state = useSocketConnectionState();
    if (state !== 'disconnected') {
        return null;
    }
    return (
        <View
            pointerEvents="none"
            accessibilityLiveRegion="polite"
            style={styles.row}
        >
            <Text style={styles.text}>Offline — showing saved data</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    row: {
        alignItems: 'center',
        paddingVertical: spacing.xxs,
    },
    text: {
        ...typography.caption,
        color: palette.neutral[500],
    },
});
