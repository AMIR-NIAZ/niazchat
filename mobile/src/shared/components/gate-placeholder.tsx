import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Screen } from './screen';
import { palette } from '../theme';
import { useTheme, useThemedStyles } from '../theme';
import type { AppTheme } from '../theme';

/** Full-screen centered spinner used while auth state is restoring. */
export function GatePlaceholder(): React.ReactElement {
    const theme = useTheme();
    const styles = useThemedStyles(createStyles);
    return (
        <Screen
            style={styles.center}
            withTopInset={false}
            withBottomInset={false}
        >
            <View style={styles.badge}>
                <ActivityIndicator color={theme.accent} size="large" />
            </View>
        </Screen>
    );
}

const createStyles = (theme: AppTheme) =>
    StyleSheet.create({
    center: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    badge: {
        padding: 18,
        borderRadius: 999,
        backgroundColor: theme.colors.glassElevated,
        borderWidth: 1,
        borderColor: theme.colors.border,
    },
});
