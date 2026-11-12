import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Screen } from './screen';
import { palette } from '../theme';

/** Full-screen centered spinner used while auth state is restoring. */
export function GatePlaceholder(): React.ReactElement {
    return (
        <Screen
            style={styles.center}
            withTopInset={false}
            withBottomInset={false}
        >
            <View style={styles.badge}>
                <ActivityIndicator color={palette.primary[300]} size="large" />
            </View>
        </Screen>
    );
}

const styles = StyleSheet.create({
    center: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    badge: {
        padding: 18,
        borderRadius: 999,
        backgroundColor: palette.glass.elevated,
        borderWidth: 1,
        borderColor: palette.border.subtle,
    },
});
