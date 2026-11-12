import { TextInputProps } from 'react-native';
import { GlassInput } from './glass-input';

/**
 * Labeled text input with inline validation error. Presentational only —
 * form wiring (react-hook-form) stays in the screens. Delegates the glass
 * styling to the shared `GlassInput`.
 */

interface FormFieldProps extends TextInputProps {
    label: string;
    error?: string | null;
}

export function FormField({
    label,
    error,
    ...rest
}: FormFieldProps): React.ReactElement {
    return <GlassInput label={label} error={error ?? null} {...rest} />;
}
