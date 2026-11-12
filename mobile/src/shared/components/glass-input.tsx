import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import type { TextInputProps } from 'react-native';
import { blob } from './glass-input.styles';
import { AppText } from './app-text';
import { palette, radii, spacing } from '../theme';

interface GlassInputProps extends TextInputProps {
    label?: string;
    error?: string | null;
    /** Renders a leading glyph/icon node inside the field. */
    leading?: React.ReactNode;
}

/**
 * Translucent input used for search, forms and invite entry. Focus and error
 * are communicated with the border colour (not blur alone), so it stays
 * readable with native blur disabled.
 */
export function GlassInput({
    label,
    error,
    leading,
    style,
    onFocus,
    onBlur,
    ...rest
}: GlassInputProps): React.ReactElement {
    const [focused, setFocused] = useState(false);
    const invalid = error !== null && error !== undefined;

    return (
        <View style={styles.container}>
            {label !== undefined && (
                <AppText variant="caption" style={styles.label}>
                    {label}
                </AppText>
            )}
            <View
                style={[
                    styles.field,
                    focused && styles.fieldFocused,
                    invalid && styles.fieldInvalid,
                ]}
            >
                {leading !== undefined && (
                    <View style={styles.leading}>{leading}</View>
                )}
                <TextInput
                    style={[styles.input, style]}
                    placeholderTextColor={palette.text.muted}
                    selectionColor={palette.primary[300]}
                    onFocus={(event): void => {
                        setFocused(true);
                        onFocus?.(event);
                    }}
                    onBlur={(event): void => {
                        setFocused(false);
                        onBlur?.(event);
                    }}
                    {...rest}
                />
            </View>
            {invalid && (
                <AppText variant="caption" style={styles.error}>
                    {error}
                </AppText>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: { gap: spacing.xxs },
    label: { color: palette.text.secondary },
    field: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        minHeight: 50,
        borderWidth: 1,
        borderColor: palette.border.subtle,
        borderRadius: radii.md,
        backgroundColor: blob.field,
        paddingHorizontal: spacing.sm,
    },
    fieldFocused: {
        borderColor: palette.border.accent,
        backgroundColor: blob.fieldFocused,
    },
    fieldInvalid: { borderColor: palette.semantic.danger },
    leading: { flexShrink: 0 },
    input: {
        flex: 1,
        paddingVertical: spacing.sm,
        fontSize: 16,
        color: palette.text.primary,
    },
    error: { color: palette.semantic.danger },
});
