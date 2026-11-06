import { StyleSheet, View, ViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { palette, spacing } from '../theme';

/**
 * Full-height, safe-area-aware container used as the root of every screen.
 * Layout is a shared concern — features compose content inside it.
 */

interface ScreenProps extends ViewProps {
  /** Pad the content away from the status bar / notch. Default: true. */
  withTopInset?: boolean;
  withBottomInset?: boolean;
}

export function Screen({
  withTopInset = true,
  withBottomInset = true,
  style,
  children,
  ...rest
}: ScreenProps): React.ReactElement {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.screen,
        { paddingTop: withTopInset ? insets.top + spacing.md : undefined },
        { paddingBottom: withBottomInset ? insets.bottom + spacing.md : undefined },
        style,
      ]}
      {...rest}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: palette.neutral[50],
  },
});
