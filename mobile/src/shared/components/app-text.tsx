import { Text, TextProps } from 'react-native';
import { MAX_FONT_SCALE, useTheme } from '../theme';

/**
 * Themed text; tokenized variants keep typography consistent across screens.
 * Variants include display / title / heading / body / label / caption.
 *
 * The style comes from the active theme, so the chosen font, text size and
 * light/dark palette apply everywhere without each screen opting in.
 */

type BaseVariant =
    | 'display'
    | 'title'
    | 'heading'
    | 'body'
    | 'label'
    | 'caption'
    | 'micro';

interface AppTextProps extends TextProps {
    variant?: BaseVariant;
}

export function AppText({
    variant = 'body',
    style,
    children,
    maxFontSizeMultiplier = MAX_FONT_SCALE,
    ...rest
}: AppTextProps): React.ReactElement {
    const theme = useTheme();
    return (
        <Text
            style={[theme.type[variant], style]}
            maxFontSizeMultiplier={maxFontSizeMultiplier}
            {...rest}
        >
            {children}
        </Text>
    );
}
