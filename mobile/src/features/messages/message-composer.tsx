import { useEffect, useRef, useState } from 'react';
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
import { isOwnMessage } from './messages-model';
import type { ReplyPreview } from './messages-model';

/**
 * Multiline message composer pinned above the keyboard. Send is disabled while
 * empty or while another send is still in flight (no duplicate submissions —
 * the backend confirms sends only via the `sendMessage:list` echo).
 *
 * When a reply is active, a compact bar above the input shows the target and
 * focuses the input so typing can start immediately.
 */

interface MessageComposerProps {
    disabled: boolean;
    onSend: (content: string) => void;
    replyTo: ReplyPreview | null;
    currentUserId: number | null;
    onCancelReply: () => void;
    /** Optional typing hooks (group chats only). */
    onTextChange?: ((text: string) => void) | undefined;
    onBlur?: (() => void) | undefined;
}

function replyName(
    replyTo: ReplyPreview,
    currentUserId: number | null,
): string {
    if (isOwnMessage(currentUserId, replyTo.senderId)) {
        return 'You';
    }
    return replyTo.senderName !== '' ? replyTo.senderName : 'Unknown';
}

function replySnippet(replyTo: ReplyPreview): string {
    if (replyTo.isDeleted) {
        return 'Message deleted';
    }
    if (replyTo.content !== null && replyTo.content.trim() !== '') {
        return replyTo.content;
    }
    if (replyTo.attachmentsCount > 0) {
        return `📎 ${replyTo.attachmentsCount} attachment${
            replyTo.attachmentsCount === 1 ? '' : 's'
        }`;
    }
    return '';
}

export function MessageComposer(
    props: MessageComposerProps,
): React.ReactElement {
    const [text, setText] = useState('');
    const inputRef = useRef<React.ComponentRef<typeof TextInput>>(null);
    const canSend = !props.disabled && text.trim() !== '';
    const replyTo = props.replyTo;

    // Focus the input when a reply starts (target identity, not object identity).
    useEffect((): void => {
        if (replyTo !== null) {
            inputRef.current?.focus();
        }
    }, [replyTo === null ? null : replyTo.id]);

    const submit = (): void => {
        if (!canSend) {
            return;
        }
        props.onSend(text);
        setText('');
        props.onTextChange?.('');
    };

    return (
        <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.avoid}
            pointerEvents="box-none"
        >
            {replyTo !== null && (
                <View style={styles.replyBar}>
                    <View style={styles.replyDivider} />
                    <View style={styles.replyTextWrap}>
                        <Text style={styles.replyTitle} numberOfLines={1}>
                            Replying to{' '}
                            {replyName(replyTo, props.currentUserId)}
                        </Text>
                        <Text style={styles.replySnippet} numberOfLines={1}>
                            {replySnippet(replyTo)}
                        </Text>
                    </View>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Cancel reply"
                        style={styles.replyClose}
                        onPress={props.onCancelReply}
                    >
                        <Text style={styles.replyCloseText}>✕</Text>
                    </Pressable>
                </View>
            )}
            <View style={styles.composer}>
                <TextInput
                    ref={inputRef}
                    style={styles.input}
                    value={text}
                    onChangeText={(value): void => {
                        setText(value);
                        props.onTextChange?.(value);
                    }}
                    onBlur={props.onBlur}
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
    replyBar: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        paddingVertical: spacing.xs,
        paddingHorizontal: spacing.xs,
        backgroundColor: palette.neutral[50],
        borderRadius: radii.sm,
        marginTop: spacing.xxs,
    },
    replyDivider: {
        width: 3,
        alignSelf: 'stretch',
        borderRadius: radii.full,
        backgroundColor: palette.primary[500],
    },
    replyTextWrap: { flex: 1 },
    replyTitle: {
        color: palette.primary[700],
        fontSize: 12,
        fontWeight: '600',
    },
    replySnippet: { color: palette.neutral[500], fontSize: 12 },
    replyClose: {
        width: 28,
        height: 28,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radii.full,
    },
    replyCloseText: { color: palette.neutral[500], fontSize: 14 },
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
