import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import type { TextInputProps } from 'react-native';
import { AppText } from './app-text';
import { radii, spacing } from '../theme';
import { useTheme, useThemedStyles } from '../theme/theme-provider';
import type { AppTheme } from '../theme/theme-provider';

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
    keyboardAppearance,
    ...rest
}: GlassInputProps): React.ReactElement {
    const theme = useTheme();
    const styles = useThemedStyles(createStyles);
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
                    <View style={styles.leading}>
                        {typeof leading === 'string' ||
                        typeof leading === 'number' ? (
                            <AppText>{leading}</AppText>
                        ) : (
                            leading
                        )}
                    </View>
                )}
                <TextInput
                    style={[styles.input, style]}
                    placeholderTextColor={theme.colors.textMuted}
                    selectionColor={theme.accent}
                    keyboardAppearance={
                        keyboardAppearance ??
                        (theme.isDark ? 'dark' : 'light')
                    }
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

const createStyles = (theme: AppTheme) =>
    StyleSheet.create({
        container: { gap: spacing.xxs },
        label: { color: theme.colors.textSecondary },
        field: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.xs,
            minHeight: 50,
            borderWidth: 1,
            borderColor: theme.colors.border,
            borderRadius: radii.md,
            backgroundColor: theme.colors.glassSurface,
            paddingHorizontal: spacing.sm,
        },
        fieldFocused: {
            borderColor: theme.colors.accentBorder,
            backgroundColor: theme.colors.glassElevated,
        },
        fieldInvalid: { borderColor: theme.colors.danger },
        leading: { flexShrink: 0 },
        input: {
            flex: 1,
            paddingVertical: spacing.sm,
            fontSize: 16,
            color: theme.colors.text,
        },
        error: { color: theme.colors.danger },
    });
