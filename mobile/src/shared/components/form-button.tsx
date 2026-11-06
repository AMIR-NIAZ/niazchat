import { Pressable, StyleSheet, Text } from 'react-native';
import { palette, radii, spacing } from '../theme';

/** Minimal form submit/cancel button used by the auth screens. */
export function FormButton(props: {
  onPress: () => void;
  label: string;
  intent?: 'primary' | 'secondary';
}): React.ReactElement {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={props.onPress}
      style={[styles.button, props.intent === 'secondary' && styles.secondary]}
    >
      <Text style={[styles.text, props.intent === 'secondary' && styles.secondaryText]}>
        {props.label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    paddingVertical: spacing.sm + 2,
    borderRadius: radii.sm,
    backgroundColor: palette.primary[500],
  },
  secondary: { backgroundColor: 'transparent' },
  text: { color: palette.neutral[0], fontSize: 16, fontWeight: '600' },
  secondaryText: { color: palette.primary[500] },
});
