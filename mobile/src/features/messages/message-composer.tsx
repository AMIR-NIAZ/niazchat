import { useState } from 'react';
import {
    KeyboardAvoidingView,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { palette, radii, spacing } from '../../shared/theme';

/**
 * Multiline message composer pinned above the keyboard. Send is disabled while
 * empty or while another send is still in flight (no duplicate submissions —
 * the backend confirms sends only via the `sendMessage:list` echo).
 */

interface MessageComposerProps {
    disabled: boolean;
    onSend: (content: string) => void;
}

export function MessageComposer(
    props: MessageComposerProps,
): React.ReactElement {
    const [text, setText] = useState('');
    const canSend = !props.disabled && text.trim() !== '';

    const submit = (): void => {
        if (!canSend) {
            return;
        }
        props.onSend(text);
        setText('');
    };

    return (
        <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.avoid}
            pointerEvents="box-none"
        >
            <View style={styles.composer}>
                <TextInput
                    style={styles.input}
                    value={text}
                    onChangeText={setText}
                    placeholder="Message…"
                    placeholderTextColor={palette.neutral[300]}
                    multiline={true}
                    numberOfLines={4}
                    editable={!props.disabled}
                    accessibilityLabel="Message input"
                    onSubmitEditing={submit}
                    blurOnSubmit={false}
                />
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Send message"
                    accessibilityState={{ disabled: !canSend }}
                    style={[
                        styles.send,
                        canSend ? styles.sendActive : styles.sendInactive,
                    ]}
                    onPress={submit}
                >
                    <Text style={styles.sendText}>➤</Text>
                </Pressable>
            </View>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    avoid: { flexShrink: 1 },
    composer: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: spacing.xs,
        paddingVertical: spacing.xs,
    },
    input: {
        flex: 1,
        minHeight: 40,
        maxHeight: 120,
        borderWidth: 1,
        borderColor: palette.neutral[300],
        borderRadius: radii.lg,
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xs + 2,
        color: palette.neutral[900],
        backgroundColor: palette.neutral[0],
        textAlignVertical: 'center',
    },
    send: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
    },
    sendActive: { backgroundColor: palette.primary[500] },
    sendInactive: { backgroundColor: palette.neutral[300] },
    sendText: { color: palette.neutral[0], fontSize: 16 },
});
