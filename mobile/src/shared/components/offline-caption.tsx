import { StyleSheet, View } from 'react-native';
import { useSocketConnectionState } from '../../core/socket/use-socket';
import { AppText } from './app-text';
import { spacing } from '../theme';
import { useThemedStyles } from '../theme/theme-provider';
import type { AppTheme } from '../theme/theme-provider';

/**
 * One-line, non-blocking notice shown while there is no backend connection and
 * the screen is rendering previously saved data. It disappears by itself once
 * the socket is back.
 */
export function OfflineCaption(): React.ReactElement | null {
    const styles = useThemedStyles(createStyles);
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
            <AppText variant="caption" style={styles.text}>
                Offline — showing saved data
            </AppText>
        </View>
    );
}

const createStyles = (theme: AppTheme) =>
    StyleSheet.create({
        row: {
            alignItems: 'center',
            paddingVertical: spacing.xxs,
        },
        text: {
            color: theme.colors.textMuted,
        },
    });
