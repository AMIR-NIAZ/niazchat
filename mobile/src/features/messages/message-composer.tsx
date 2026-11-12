import { useEffect, useRef, useState } from 'react';
import {
    Alert,
    KeyboardAvoidingView,
    Linking,
    Modal,
    PanResponder,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { blur, palette, radii, spacing } from '../../shared/theme';
import { GlassSurface } from '../../shared/components';
import { isOwnMessage } from './messages-model';
import type { ReplyPreview } from './messages-model';
import { attachmentPreviewLabel } from '../attachments/attachment-labels';
import {
    kindOfSelection,
    validateNewAttachments,
} from '../attachments/validation';
import type { LocalAttachment } from '../attachments/validation';
import { MAX_ATTACHMENTS_PER_MESSAGE } from '../attachments/constants';
import { nextSelectionKey } from './local-keys';
import {
    playVoiceMessage,
    stopVoice,
    toggleVoice,
    useVoicePlayback,
} from '../voice/voice-playback';
import type { VoiceDraft } from '../voice/voice-draft-store';
import { useVoiceRecorder } from '../voice/use-voice-recorder';
import { VoiceRecorderBar } from '../voice/voice-recorder-bar';
import { formatDuration, hasDuration } from '../attachments/duration';

/**
 * Multiline message composer with attachments.
 *
 * The "+" button opens Photos / Camera / File. Selected items appear in a tray
 * above the input (thumbnail or file chip, removable); the text input becomes
 * the caption. Send is enabled when there is text or at least one attachment.
 * Uploading happens after send, in `use-chat-messages`.
 */

interface MessageComposerProps {
    chatId: number;
    disabled: boolean;
    onSend: (content: string, attachments: LocalAttachment[]) => void;
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
    return attachmentPreviewLabel(
        replyTo.attachmentsCount,
        replyTo.attachmentKind,
        null,
        replyTo.attachmentDuration,
    );
}

export function MessageComposer(
    props: MessageComposerProps,
): React.ReactElement {
    const [text, setText] = useState('');
    const [selected, setSelected] = useState<LocalAttachment[]>([]);
    const [sheetOpen, setSheetOpen] = useState(false);
    const [picking, setPicking] = useState(false);
    const inputRef = useRef<React.ComponentRef<typeof TextInput>>(null);
    const canSend =
        !props.disabled && (text.trim() !== '' || selected.length > 0);
    const replyTo = props.replyTo;

    const recorder = useVoiceRecorder(props.chatId);
    const draftPlayback = useVoicePlayback();
    const draftPlaybackId = -1_000_000 - props.chatId;
    const [recordingMode, setRecordingMode] = useState<'tap' | 'hold' | null>(
        null,
    );
    const [holdHint, setHoldHint] = useState<string | null>(null);
    const [cancelArmed, setCancelArmed] = useState(false);
    const recorderRef = useRef(recorder);
    recorderRef.current = recorder;
    const disabledRef = useRef(props.disabled);
    disabledRef.current = props.disabled;
    const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const heldRef = useRef(false);
    const cancelRef = useRef(false);
    const lockedRef = useRef(false);
    const sendVoiceClipRef = useRef<(clip: VoiceDraft) => void>(
        (): void => undefined,
    );
    const finishAndSendRef = useRef<() => Promise<void>>(() =>
        Promise.resolve(),
    );
    const micEnabled =
        !props.disabled &&
        recorder.phase !== 'recording' &&
        recorder.draft === null;
    const { hint: recorderHint, clearHint } = recorder;

    useEffect((): (() => void) | void => {
        if (recorderHint === null) return;
        const timer = setTimeout(clearHint, 2500);
        return (): void => clearTimeout(timer);
    }, [recorderHint, clearHint]);

    useEffect((): void => {
        if (replyTo !== null) {
            inputRef.current?.focus();
        }
    }, [replyTo === null ? null : replyTo.id]);

    const addAttachments = (candidates: LocalAttachment[]): void => {
        if (candidates.length === 0) return;
        const result = validateNewAttachments(selected, candidates);
        if (result.error !== null) {
            Alert.alert('Cannot attach file', result.error);
            return;
        }
        setSelected((current) => [...current, ...result.accepted]);
    };

    const sendVoiceClip = (clip: VoiceDraft): void => {
        props.onSend('', [
            {
                localKey: nextSelectionKey(),
                uri: clip.uri,
                name: `voice-${Date.now()}.m4a`,
                mimeType: 'audio/mp4',
                size: 0,
                kind: 'voice',
                duration: clip.duration,
                waveform: clip.waveform,
            },
        ]);
    };
    sendVoiceClipRef.current = sendVoiceClip;

    const finishAndSend = async (): Promise<void> => {
        const clip = await recorder.finish();
        setRecordingMode(null);
        setHoldHint(null);
        setCancelArmed(false);
        if (clip !== null) sendVoiceClipRef.current(clip);
    };
    finishAndSendRef.current = finishAndSend;

    const startTapRecording = (): void => {
        if (disabledRef.current) return;
        const current = recorderRef.current;
        if (current.draft !== null) current.discardDraft();
        setRecordingMode('tap');
        void current.start();
    };

    const cancelRecording = (): void => {
        void recorder.cancel();
        setRecordingMode(null);
        setHoldHint(null);
        setCancelArmed(false);
    };

    const handleCancelRecording = (): void => {
        if (recorder.durationMs < 5000) {
            cancelRecording();
            return;
        }
        Alert.alert(
            'Discard recording?',
            'This voice message will be deleted.',
            [
                { text: 'Keep recording', style: 'cancel' },
                {
                    text: 'Discard',
                    style: 'destructive',
                    onPress: cancelRecording,
                },
            ],
        );
    };

    const handleSendDraft = (): void => {
        const clip = recorder.takeDraft();
        if (clip === null) return;
        if (draftPlayback.attachmentId === draftPlaybackId) stopVoice();
        sendVoiceClipRef.current(clip);
    };

    const handleDiscardDraft = (): void => {
        if (draftPlayback.attachmentId === draftPlaybackId) stopVoice();
        recorder.discardDraft();
    };

    const handleToggleDraft = (): void => {
        const draft = recorder.draft;
        if (draft === null) return;
        if (draftPlayback.attachmentId === draftPlaybackId) {
            toggleVoice(draftPlaybackId);
            return;
        }
        void playVoiceMessage(draftPlaybackId, draft.uri, draft.duration);
    };

    const micResponder = useRef(
        PanResponder.create({
            onStartShouldSetPanResponder: (): boolean => true,
            onMoveShouldSetPanResponder: (): boolean => true,
            onPanResponderGrant: (): void => {
                cancelRef.current = false;
                lockedRef.current = false;
                heldRef.current = false;
                setCancelArmed(false);
                setHoldHint(null);
                holdTimerRef.current = setTimeout((): void => {
                    holdTimerRef.current = null;
                    if (disabledRef.current) return;
                    heldRef.current = true;
                    setRecordingMode('hold');
                    const current = recorderRef.current;
                    if (current.draft !== null) current.discardDraft();
                    void current.start();
                }, 250);
            },
            onPanResponderMove: (_event, gesture): void => {
                if (!heldRef.current) return;
                if (gesture.dx < -70) {
                    cancelRef.current = true;
                    setCancelArmed(true);
                    setHoldHint('Release to cancel');
                    return;
                }
                if (gesture.dy < -60) {
                    lockedRef.current = true;
                    setHoldHint('Release to lock');
                    return;
                }
                cancelRef.current = false;
                setCancelArmed(false);
                setHoldHint('Release to send');
            },
            onPanResponderRelease: (): void => {
                if (holdTimerRef.current !== null) {
                    clearTimeout(holdTimerRef.current);
                    holdTimerRef.current = null;
                }
                if (!heldRef.current) {
                    startTapRecording();
                    return;
                }
                heldRef.current = false;
                if (lockedRef.current) {
                    setRecordingMode('tap');
                    setHoldHint(null);
                    setCancelArmed(false);
                    return;
                }
                if (cancelRef.current) {
                    cancelRecording();
                    return;
                }
                void finishAndSendRef.current();
            },
            onPanResponderTerminate: (): void => {
                if (holdTimerRef.current !== null) {
                    clearTimeout(holdTimerRef.current);
                    holdTimerRef.current = null;
                }
                heldRef.current = false;
                cancelRecording();
            },
        }),
    ).current;

    const remaining = MAX_ATTACHMENTS_PER_MESSAGE - selected.length;

    const pickPhotos = async (): Promise<void> => {
        if (remaining <= 0) {
            Alert.alert(
                'Attachment limit',
                `You can attach up to ${MAX_ATTACHMENTS_PER_MESSAGE} files.`,
            );
            return;
        }
        const permission =
            await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
            Alert.alert(
                'Photo access needed',
                'Allow photo access in Settings to attach photos.',
                [
                    { text: 'Cancel', style: 'cancel' },
                    {
                        text: 'Open settings',
                        onPress: (): void => {
                            void Linking.openSettings();
                        },
                    },
                ],
            );
            return;
        }
        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            allowsMultipleSelection: true,
            selectionLimit: remaining,
            quality: 0.8,
        });
        if (result.canceled) return;
        addAttachments(
            result.assets.map((asset, index) => {
                const name =
                    asset.fileName ?? `photo-${Date.now()}-${index + 1}.jpg`;
                const mimeType = asset.mimeType ?? 'image/jpeg';
                return {
                    localKey: nextSelectionKey(),
                    uri: asset.uri,
                    name,
                    mimeType,
                    size: asset.fileSize ?? 0,
                    kind: kindOfSelection(mimeType, name),
                    ...(asset.width > 0 && asset.height > 0
                        ? { width: asset.width, height: asset.height }
                        : {}),
                };
            }),
        );
    };

    const takePhoto = async (): Promise<void> => {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
            Alert.alert(
                'Camera access needed',
                'Allow camera access in Settings to take a photo.',
                [
                    { text: 'Cancel', style: 'cancel' },
                    {
                        text: 'Open settings',
                        onPress: (): void => {
                            void Linking.openSettings();
                        },
                    },
                ],
            );
            return;
        }
        const result = await ImagePicker.launchCameraAsync({
            mediaTypes: ['images'],
            quality: 0.8,
        });
        if (result.canceled) return;
        addAttachments(
            result.assets.map((asset, index) => {
                const name =
                    asset.fileName ?? `camera-${Date.now()}-${index + 1}.jpg`;
                const mimeType = asset.mimeType ?? 'image/jpeg';
                return {
                    localKey: nextSelectionKey(),
                    uri: asset.uri,
                    name,
                    mimeType,
                    size: asset.fileSize ?? 0,
                    kind: kindOfSelection(mimeType, name),
                    ...(asset.width > 0 && asset.height > 0
                        ? { width: asset.width, height: asset.height }
                        : {}),
                };
            }),
        );
    };

    const pickVideos = async (): Promise<void> => {
        if (remaining <= 0) {
            Alert.alert(
                'Attachment limit',
                `You can attach up to ${MAX_ATTACHMENTS_PER_MESSAGE} files.`,
            );
            return;
        }
        const permission =
            await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
            Alert.alert(
                'Video access needed',
                'Allow media access in Settings to attach a video.',
                [
                    { text: 'Cancel', style: 'cancel' },
                    {
                        text: 'Open settings',
                        onPress: (): void => {
                            void Linking.openSettings();
                        },
                    },
                ],
            );
            return;
        }
        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['videos'],
            allowsMultipleSelection: true,
            selectionLimit: remaining,
        });
        if (result.canceled) return;
        addAttachments(
            result.assets.map((asset, index) => {
                const name =
                    asset.fileName ?? `video-${Date.now()}-${index + 1}.mp4`;
                const mimeType = asset.mimeType ?? 'video/mp4';
                return {
                    localKey: nextSelectionKey(),
                    uri: asset.uri,
                    name,
                    mimeType,
                    size: asset.fileSize ?? 0,
                    kind: 'video' as const,
                    ...(typeof asset.duration === 'number' && asset.duration > 0
                        ? { duration: asset.duration / 1000 }
                        : {}),
                };
            }),
        );
    };

    const pickFiles = async (): Promise<void> => {
        if (remaining <= 0) {
            Alert.alert(
                'Attachment limit',
                `You can attach up to ${MAX_ATTACHMENTS_PER_MESSAGE} files.`,
            );
            return;
        }
        const result = await DocumentPicker.getDocumentAsync({
            multiple: true,
            copyToCacheDirectory: true,
        });
        if (result.canceled) return;
        addAttachments(
            result.assets.slice(0, remaining).map((asset) => ({
                localKey: nextSelectionKey(),
                uri: asset.uri,
                name: asset.name,
                mimeType: asset.mimeType ?? 'application/octet-stream',
                size: asset.size ?? 0,
                kind: kindOfSelection(asset.mimeType, asset.name),
            })),
        );
    };

    const runPicker = async (pick: () => Promise<void>): Promise<void> => {
        setSheetOpen(false);
        if (picking) return;
        setPicking(true);
        try {
            await pick();
        } catch {
            Alert.alert(
                'Could not attach',
                'Something went wrong while opening the picker. Try again.',
            );
        } finally {
            setPicking(false);
        }
    };

    const submit = (): void => {
        if (!canSend) return;
        props.onSend(text, selected);
        setText('');
        setSelected([]);
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

            {recorder.phase === 'recording' && (
                <VoiceRecorderBar
                    durationMs={recorder.durationMs}
                    level={recorder.level}
                    hint={
                        recordingMode === 'hold'
                            ? cancelArmed
                                ? 'Release to cancel'
                                : (holdHint ?? 'Release to send')
                            : 'Tap trash to cancel'
                    }
                    onCancel={handleCancelRecording}
                    onSend={(): void => {
                        void finishAndSend();
                    }}
                />
            )}

            {recorder.phase !== 'recording' && recorder.draft !== null && (
                <View style={styles.draftRow}>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Play draft voice message, ${formatDuration(
                            recorder.draft.duration,
                        )}`}
                        onPress={handleToggleDraft}
                        style={styles.draftPlay}
                    >
                        <Text style={styles.draftPlayText}>
                            {draftPlayback.attachmentId === draftPlaybackId &&
                            draftPlayback.playing
                                ? '❚❚'
                                : '▶'}
                        </Text>
                    </Pressable>
                    <Text style={styles.draftTime}>
                        {hasDuration(recorder.draft.duration)
                            ? formatDuration(recorder.draft.duration)
                            : '0:00'}
                    </Text>
                    <Text style={styles.draftLabel} numberOfLines={1}>
                        Voice draft
                    </Text>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Send voice message"
                        onPress={handleSendDraft}
                        style={styles.draftAction}
                    >
                        <Text style={styles.draftActionText}>Send</Text>
                    </Pressable>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Delete voice draft"
                        onPress={handleDiscardDraft}
                        style={styles.draftAction}
                    >
                        <Text style={styles.draftDeleteText}>Delete</Text>
                    </Pressable>
                </View>
            )}

            {recorderHint !== null && recorder.phase !== 'recording' && (
                <Text style={styles.voiceHint}>{recorderHint}</Text>
            )}

            {selected.length > 0 && (
                <View style={styles.trayWrap}>
                    <View style={styles.trayHeader}>
                        <Text style={styles.trayCount}>
                            {selected.length}/{MAX_ATTACHMENTS_PER_MESSAGE}
                        </Text>
                    </View>
                    <ScrollView
                        horizontal={true}
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.tray}
                    >
                        {selected.map((item) => (
                            <View key={item.localKey} style={styles.trayItem}>
                                {item.kind === 'image' ? (
                                    <Image
                                        source={{ uri: item.uri }}
                                        style={styles.trayImage}
                                        contentFit="cover"
                                        cachePolicy="memory"
                                    />
                                ) : item.kind === 'video' ? (
                                    <View style={styles.trayFile}>
                                        <Text style={styles.trayFileIcon}>
                                            🎬
                                        </Text>
                                        <Text
                                            style={styles.trayFileName}
                                            numberOfLines={2}
                                        >
                                            {item.name}
                                        </Text>
                                    </View>
                                ) : (
                                    <View style={styles.trayFile}>
                                        <Text
                                            style={styles.trayFileIcon}
                                            numberOfLines={1}
                                        >
                                            📎
                                        </Text>
                                        <Text
                                            style={styles.trayFileName}
                                            numberOfLines={2}
                                        >
                                            {item.name}
                                        </Text>
                                    </View>
                                )}
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel={`Remove ${item.name}`}
                                    hitSlop={8}
                                    style={styles.trayRemove}
                                    onPress={(): void =>
                                        setSelected((current) =>
                                            current.filter(
                                                (entry) =>
                                                    entry.localKey !==
                                                    item.localKey,
                                            ),
                                        )
                                    }
                                >
                                    <Text style={styles.trayRemoveText}>✕</Text>
                                </Pressable>
                            </View>
                        ))}
                    </ScrollView>
                </View>
            )}

            <GlassSurface
                tone="elevated"
                intensity={blur.strong}
                radius={radii.xl}
                style={styles.composer}
            >
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Attach photo or file"
                    accessibilityState={{ disabled: props.disabled || picking }}
                    disabled={props.disabled || picking}
                    onPress={(): void => setSheetOpen(true)}
                    style={[
                        styles.attach,
                        props.disabled && styles.attachDisabled,
                    ]}
                >
                    <Text style={styles.attachText}>＋</Text>
                </Pressable>
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
                {text.trim() === '' && selected.length === 0 ? (
                    <View
                        {...micResponder.panHandlers}
                        accessible={true}
                        accessibilityRole="button"
                        accessibilityLabel="Start recording"
                        accessibilityState={{ disabled: !micEnabled }}
                        onAccessibilityTap={startTapRecording}
                        style={[
                            styles.send,
                            micEnabled ? styles.micActive : styles.sendInactive,
                        ]}
                    >
                        <Text style={styles.micText}>🎤</Text>
                    </View>
                ) : (
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
                )}
            </GlassSurface>

            <Modal
                visible={sheetOpen}
                transparent={true}
                animationType="slide"
                onRequestClose={(): void => setSheetOpen(false)}
            >
                <Pressable
                    style={styles.sheetBackdrop}
                    onPress={(): void => setSheetOpen(false)}
                >
                    <Pressable style={styles.sheetCard}>
                        <Text style={styles.sheetTitle}>Attach</Text>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Choose photos"
                            style={styles.sheetButton}
                            onPress={(): void => {
                                void runPicker(pickPhotos);
                            }}
                        >
                            <Text style={styles.sheetAction}>Photos</Text>
                        </Pressable>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Take a photo"
                            style={styles.sheetButton}
                            onPress={(): void => {
                                void runPicker(takePhoto);
                            }}
                        >
                            <Text style={styles.sheetAction}>Camera</Text>
                        </Pressable>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Choose a video"
                            style={styles.sheetButton}
                            onPress={(): void => {
                                void runPicker(pickVideos);
                            }}
                        >
                            <Text style={styles.sheetAction}>Video</Text>
                        </Pressable>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Choose a file"
                            style={styles.sheetButton}
                            onPress={(): void => {
                                void runPicker(pickFiles);
                            }}
                        >
                            <Text style={styles.sheetAction}>File</Text>
                        </Pressable>
                        <View style={styles.sheetDivider} />
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Cancel attach menu"
                            style={styles.sheetButton}
                            onPress={(): void => setSheetOpen(false)}
                        >
                            <Text style={styles.sheetCancel}>Cancel</Text>
                        </Pressable>
                    </Pressable>
                </Pressable>
            </Modal>
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
        backgroundColor: palette.glass.elevated,
        borderRadius: radii.md,
        borderWidth: 1,
        borderColor: palette.border.subtle,
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
    replySnippet: { color: palette.text.secondary, fontSize: 12 },
    replyClose: {
        width: 28,
        height: 28,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radii.full,
    },
    replyCloseText: { color: palette.neutral[500], fontSize: 14 },
    trayWrap: { marginTop: spacing.xxs },
    trayHeader: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        paddingHorizontal: spacing.xxs,
    },
    trayCount: { color: palette.neutral[500], fontSize: 11 },
    tray: {
        flexDirection: 'row',
        gap: spacing.xs,
        paddingVertical: spacing.xxs,
    },
    trayItem: {
        width: 56,
        height: 56,
        borderRadius: radii.sm,
        overflow: 'hidden',
        backgroundColor: palette.neutral[100],
    },
    trayImage: { width: '100%', height: '100%' },
    trayFile: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 2,
    },
    trayFileIcon: { fontSize: 18 },
    trayFileName: {
        color: palette.neutral[700],
        fontSize: 8,
        textAlign: 'center',
    },
    trayRemove: {
        position: 'absolute',
        top: 1,
        right: 1,
        width: 18,
        height: 18,
        borderRadius: radii.full,
        backgroundColor: 'rgba(28, 32, 36, 0.75)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    trayRemoveText: { color: palette.text.onAccent, fontSize: 10 },
    composer: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: spacing.xs,
        paddingHorizontal: spacing.xs,
        paddingVertical: spacing.xs,
        marginTop: spacing.xxs,
    },
    attach: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: palette.glass.accent,
        borderWidth: 1,
        borderColor: palette.border.subtle,
    },
    attachDisabled: { opacity: 0.5 },
    attachText: {
        color: palette.primary[600],
        fontSize: 22,
        fontWeight: '600',
        lineHeight: 24,
    },
    input: {
        flex: 1,
        minHeight: 40,
        maxHeight: 120,
        borderWidth: 1,
        borderColor: palette.border.subtle,
        borderRadius: radii.lg,
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xs + 2,
        color: palette.text.primary,
        backgroundColor: palette.glass.highlight,
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
    micActive: { backgroundColor: palette.primary[100] },
    sendText: { color: palette.text.onAccent, fontSize: 16 },
    micText: { fontSize: 17 },
    draftRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        paddingVertical: spacing.xs,
        paddingHorizontal: spacing.xs,
        borderRadius: radii.lg,
        backgroundColor: palette.glass.elevated,
        borderWidth: 1,
        borderColor: palette.border.subtle,
    },
    draftPlay: {
        width: 34,
        height: 34,
        borderRadius: radii.full,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: palette.primary[100],
    },
    draftPlayText: { color: palette.primary[600], fontSize: 13 },
    draftTime: {
        color: palette.neutral[900],
        fontSize: 13,
        fontVariant: ['tabular-nums'],
    },
    draftLabel: { flex: 1, color: palette.neutral[500], fontSize: 11 },
    draftAction: {
        paddingHorizontal: spacing.xs,
        paddingVertical: 4,
        borderRadius: radii.sm,
        backgroundColor: 'rgba(28, 32, 36, 0.10)',
    },
    draftActionText: {
        color: palette.primary[700],
        fontSize: 11,
        fontWeight: '700',
    },
    draftDeleteText: {
        color: palette.semantic.danger,
        fontSize: 11,
        fontWeight: '700',
    },
    voiceHint: {
        color: palette.neutral[500],
        fontSize: 11,
        paddingHorizontal: spacing.xs,
        paddingVertical: spacing.xxs,
    },
    sheetBackdrop: {
        flex: 1,
        backgroundColor: 'rgba(28, 32, 36, 0.45)',
        justifyContent: 'flex-end',
    },
    sheetCard: {
        backgroundColor: palette.elevated,
        borderTopLeftRadius: radii.xl,
        borderTopRightRadius: radii.xl,
        padding: spacing.md,
        gap: spacing.xxs,
        borderWidth: 1,
        borderColor: palette.border.subtle,
    },
    sheetTitle: {
        color: palette.neutral[500],
        fontSize: 12,
        fontWeight: '600',
        paddingVertical: spacing.xs,
    },
    sheetButton: {
        paddingVertical: spacing.sm,
        paddingHorizontal: spacing.xs,
    },
    sheetAction: {
        color: palette.text.primary,
        fontSize: 16,
        fontWeight: '500',
    },
    sheetCancel: {
        color: palette.neutral[700],
        fontSize: 16,
        fontWeight: '500',
    },
    sheetDivider: {
        height: 1,
        backgroundColor: palette.neutral[100],
        marginVertical: spacing.xxs,
    },
});
