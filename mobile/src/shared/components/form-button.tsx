import { PrimaryButton } from './primary-button';

/**
 * Form submit/cancel button used by the auth and group screens. Kept as a thin
 * adapter so existing screens inherit the animated glass button without any
 * wiring changes.
 */
export function FormButton(props: {
    onPress: () => void;
    label: string;
    intent?: 'primary' | 'secondary';
}): React.ReactElement {
    return (
        <PrimaryButton
            label={props.label}
            onPress={props.onPress}
            variant={props.intent === 'secondary' ? 'secondary' : 'primary'}
        />
    );
}
