import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Screen } from './screen';
import { palette as paletteTokens } from '../theme';

/** Full-screen centered spinner used while auth state is restoring. */
export function GatePlaceholder(): React.ReactElement {
  return (
    <Screen style={styles.center} withTopInset={false} withBottomInset={false}>
      <View>
        <ActivityIndicator color={paletteTokens.primary[500]} size="large" />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: paletteTokens.neutral[0],
  },
});
