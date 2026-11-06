import { StyleSheet, Text, TextInput, View, TextInputProps } from 'react-native';
import { AppText } from './app-text';
import { palette, radii, spacing, typography } from '../theme';

/**
 * Labeled text input with inline validation error. Presentational only —
 * form wiring (react-hook-form) stays in the screens.
 */

interface FormFieldProps extends TextInputProps {
  label: string;
  error?: string | null;
}

export function FormField({ label, error, style, ...rest }: FormFieldProps): React.ReactElement {
  return (
    <View style={styles.container}>
      <AppText variant="caption" style={styles.label}>
        {label}
      </AppText>
      <TextInput
        style={[styles.input, error !== null && error !== undefined && styles.inputInvalid, style]}
        placeholderTextColor={palette.neutral[300]}
        {...rest}
      />
      {error !== null && error !== undefined && (
        <Text style={[typography.caption, styles.errorText]}>{error}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xxs,
  },
  label: {
    color: palette.neutral[700],
  },
  input: {
    borderWidth: 1,
    borderColor: palette.neutral[300],
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs + 2,
    fontSize: 16,
    color: palette.neutral[900],
    backgroundColor: palette.neutral[0],
  },
  inputInvalid: {
    borderColor: palette.semantic.danger,
  },
  errorText: {
    color: palette.semantic.danger,
  },
});
