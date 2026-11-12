import { Text, TextProps } from 'react-native';
import { typography } from '../theme';

/**
 * Themed text; tokenized variants keep typography consistent across screens.
 * Variants include display / title / heading / body / label / caption.
 */

type Variant = keyof typeof typography;

interface AppTextProps extends TextProps {
    variant?: Variant;
}

export function AppText({
    variant = 'body',
    style,
    children,
    ...rest
}: AppTextProps): React.ReactElement {
    return (
        <Text style={[typography[variant], style]} {...rest}>
            {children}
        </Text>
    );
}
