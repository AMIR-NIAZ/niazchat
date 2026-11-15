import { useEffect, useState } from 'react';
import {
    KeyboardAvoidingView,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import {
    AppText,
    GlassBottomSheet,
    GlassInput,
    PrimaryButton,
    UserAvatar,
    palette,
    radii,
    spacing,
    typography,
} from '../../shared/components';
import { toast } from '../../shared/dialog';
import { ApiError } from '../../core/api';
import { openPrivateChat } from '../chats';
import {
    lookupContactByPhone,
    lookupContactByUsername,
} from './contact-lookup';
import type { ContactLookupResult } from './contact-lookup';
import { describeContactsMatchError } from './contacts-service';
import { describeSavedContactError } from './contacts-api';
import { deviceDefaultRegion, normalizePhone } from './contacts-phone';
import { useAddContact } from './use-contacts';

/**
 * "Add contact" bottom sheet.
 *
 * Flow: name (optional) → segmented Phone | Username → Find → preview the
 * matched account → Save contact. Nothing is saved before the preview, so an
 * unknown person answers "This person isn't on the app yet" and a duplicate
 * shows "Already in your contacts" with a shortcut to the chat.
 */

type Mode = 'phone' | 'username';
type Phase = 'input' | 'found' | 'notFound' | 'already';

interface AddContactSheetProps {
    visible: boolean;
    onClose: () => void;
}

export function AddContactSheet({
    visible,
    onClose,
}: AddContactSheetProps): React.ReactElement {
    const queryClient = useQueryClient();
    const addContact = useAddContact();
    const [mode, setMode] = useState<Mode>('phone');
    const [name, setName] = useState('');
    const [phoneValue, setPhoneValue] = useState('');
    const [usernameValue, setUsernameValue] = useState('');
    const [phase, setPhase] = useState<Phase>('input');
    const [preview, setPreview] = useState<ContactLookupResult | null>(null);
    const [normalizedPhone, setNormalizedPhone] = useState<string | null>(null);
    const [finding, setFinding] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const region = deviceDefaultRegion();
    const phone = normalizePhone(phoneValue, region);
    const username = usernameValue.trim().replace(/^@/, '');
    const currentValue = mode === 'phone' ? phoneValue : usernameValue;
    const inputValid = mode === 'phone' ? phone !== null : username.length >= 2;
    const validationError =
        currentValue.trim() === ''
            ? null
            : mode === 'phone'
              ? phone === null
                  ? 'Enter a valid phone number'
                  : null
              : username.length < 2
                ? 'Enter at least 2 characters'
                : null;

    useEffect((): void => {
        if (visible) {
            setPhase('input');
            setPreview(null);
            setNormalizedPhone(null);
            setError(null);
        }
    }, [visible]);

    const resetToInput = (): void => {
        setPhase('input');
        setPreview(null);
        setError(null);
    };

    const handleFind = async (): Promise<void> => {
        if (!inputValid || finding) {
            return;
        }
        setFinding(true);
        setError(null);
        try {
            if (mode === 'phone') {
                const result = await lookupContactByPhone(phoneValue);
                setNormalizedPhone(result.normalized);
                if (result.user === null) {
                    setPreview(null);
                    setPhase('notFound');
                } else {
                    setPreview(result.user);
                    setPhase('found');
                }
            } else {
                const result = await lookupContactByUsername(username);
                if (result === null) {
                    setPreview(null);
                    setPhase('notFound');
                } else {
                    setPreview(result);
                    setPhase('found');
                }
            }
        } catch (failure) {
            setError(describeContactsMatchError(failure));
        } finally {
            setFinding(false);
        }
    };

    const handleSave = async (): Promise<void> => {
        if (preview === null || saving) {
            return;
        }
        setSaving(true);
        setError(null);
        try {
            await addContact.mutateAsync({
                ...(mode === 'phone'
                    ? { phone: normalizedPhone ?? phone ?? phoneValue.trim() }
                    : { username: preview.username ?? username }),
                ...(name.trim() === '' ? {} : { alias: name.trim() }),
                preview: {
                    userId: preview.userId,
                    name: preview.name,
                    username: preview.username,
                    avatarUrl: preview.avatarUrl,
                },
            });
            toast.show('Contact saved', { tone: 'success' });
            setName('');
            setPhoneValue('');
            setUsernameValue('');
            setPhase('input');
            onClose();
        } catch (failure) {
            if (failure instanceof ApiError && failure.statusCode === 409) {
                setPhase('already');
            } else {
                setError(describeSavedContactError(failure));
            }
        } finally {
            setSaving(false);
        }
    };

    const openChat = async (): Promise<void> => {
        if (preview === null) {
            return;
        }
        try {
            await openPrivateChat(preview.userId, { queryClient });
            onClose();
        } catch (failure) {
            setError(
                failure instanceof Error
                    ? failure.message
                    : 'Could not start this chat.',
            );
        }
    };

    return (
        <GlassBottomSheet
            visible={visible}
            onClose={onClose}
            title="Add contact"
        >
            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                keyboardVerticalOffset={spacing.xl}
            >
                <ScrollView
                    keyboardShouldPersistTaps="handled"
                    contentContainerStyle={styles.body}
                >
                    <GlassInput
                        label="Name (optional)"
                        placeholder="e.g. Maryam (work)"
                        value={name}
                        onChangeText={setName}
                        autoCapitalize="words"
                        maxLength={60}
                        accessibilityLabel="Contact name"
                    />

                    {phase === 'input' && (
                        <>
                            <View
                                style={styles.segment}
                                accessibilityRole="tablist"
                            >
                                <SegmentButton
                                    label="Phone"
                                    selected={mode === 'phone'}
                                    onPress={(): void => {
                                        setMode('phone');
                                        resetToInput();
                                    }}
                                />
                                <SegmentButton
                                    label="Username"
                                    selected={mode === 'username'}
                                    onPress={(): void => {
                                        setMode('username');
                                        resetToInput();
                                    }}
                                />
                            </View>

                            {mode === 'phone' ? (
                                <GlassInput
                                    placeholder="0912 345 6789"
                                    value={phoneValue}
                                    onChangeText={(text): void => {
                                        setPhoneValue(text);
                                        setPhase('input');
                                        setError(null);
                                    }}
                                    keyboardType="phone-pad"
                                    maxLength={24}
                                    error={validationError}
                                    leading={
                                        <Text style={styles.fieldGlyph}>☎</Text>
                                    }
                                    accessibilityLabel="Phone number"
                                />
                            ) : (
                                <GlassInput
                                    placeholder="@username"
                                    value={usernameValue}
                                    onChangeText={(text): void => {
                                        setUsernameValue(text);
                                        setPhase('input');
                                        setError(null);
                                    }}
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                    maxLength={31}
                                    error={validationError}
                                    leading={
                                        <Text style={styles.fieldGlyph}>@</Text>
                                    }
                                    accessibilityLabel="Username"
                                />
                            )}

                            <AppText variant="caption">
                                Phone numbers are normalized before they are
                                sent. Only people already on the app can be
                                added.
                            </AppText>
                        </>
                    )}

                    {phase === 'found' && preview !== null && (
                        <View style={styles.previewCard}>
                            <UserAvatar
                                userId={preview.userId}
                                name={preview.name}
                                uri={preview.avatarUrl}
                                size={52}
                            />
                            <View style={styles.previewBody}>
                                <Text style={typography.body} numberOfLines={1}>
                                    {preview.name}
                                </Text>
                                {preview.username !== null && (
                                    <Text
                                        style={typography.caption}
                                        numberOfLines={1}
                                    >
                                        @{preview.username}
                                    </Text>
                                )}
                            </View>
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="Choose another person"
                                onPress={resetToInput}
                                style={({ pressed }) => [
                                    styles.linkButton,
                                    pressed && styles.pressed,
                                ]}
                            >
                                <Text style={styles.linkText}>Change</Text>
                            </Pressable>
                        </View>
                    )}

                    {phase === 'notFound' && (
                        <View style={styles.stateCard}>
                            <Text style={styles.stateTitle}>
                                This person isn't on the app yet
                            </Text>
                            <AppText variant="caption" style={styles.stateText}>
                                Check the number or username, or invite them to
                                NiazChat.
                            </AppText>
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="Try another phone or username"
                                onPress={resetToInput}
                                style={({ pressed }) => [
                                    styles.linkButton,
                                    pressed && styles.pressed,
                                ]}
                            >
                                <Text style={styles.linkText}>Try again</Text>
                            </Pressable>
                        </View>
                    )}

                    {phase === 'already' && (
                        <View style={styles.stateCard}>
                            <Text style={styles.stateTitle}>
                                Already in your contacts
                            </Text>
                            <AppText variant="caption" style={styles.stateText}>
                                You can message them right away.
                            </AppText>
                            <View style={styles.rowButtons}>
                                <PrimaryButton
                                    label="Message"
                                    onPress={(): void => {
                                        void openChat();
                                    }}
                                    variant="primary"
                                    fullWidth={false}
                                    style={styles.grow}
                                />
                                <PrimaryButton
                                    label="Close"
                                    onPress={onClose}
                                    variant="secondary"
                                    fullWidth={false}
                                    style={styles.grow}
                                />
                            </View>
                        </View>
                    )}

                    {error !== null && (
                        <AppText style={styles.error}>{error}</AppText>
                    )}

                    {phase === 'input' && (
                        <PrimaryButton
                            label="Find"
                            onPress={(): void => {
                                void handleFind();
                            }}
                            loading={finding}
                            disabled={!inputValid}
                        />
                    )}

                    {phase === 'found' && (
                        <PrimaryButton
                            label={
                                name.trim() === ''
                                    ? 'Save contact'
                                    : `Save as ${name.trim()}`
                            }
                            onPress={(): void => {
                                void handleSave();
                            }}
                            loading={saving}
                        />
                    )}
                </ScrollView>
            </KeyboardAvoidingView>
        </GlassBottomSheet>
    );
}

function SegmentButton({
    label,
    selected,
    onPress,
}: {
    label: string;
    selected: boolean;
    onPress: () => void;
}): React.ReactElement {
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ selected }}
            onPress={onPress}
            style={({ pressed }) => [
                styles.segmentButton,
                selected && styles.segmentSelected,
                pressed && styles.pressed,
            ]}
        >
            <Text
                style={[
                    styles.segmentText,
                    selected && styles.segmentTextSelected,
                ]}
            >
                {label}
            </Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    body: { gap: spacing.sm, paddingBottom: spacing.xs },
    segment: {
        flexDirection: 'row',
        padding: 4,
        gap: 4,
        borderRadius: radii.full,
        backgroundColor: palette.glass.highlight,
        borderWidth: 1,
        borderColor: palette.border.subtle,
    },
    segmentButton: {
        flex: 1,
        alignItems: 'center',
        paddingVertical: spacing.xs,
        borderRadius: radii.full,
    },
    segmentSelected: { backgroundColor: palette.primary[500] },
    segmentText: {
        color: palette.text.secondary,
        fontSize: 13,
        fontWeight: '600',
    },
    segmentTextSelected: { color: palette.text.onAccent },
    fieldGlyph: { color: palette.text.muted, fontSize: 16 },
    previewCard: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        padding: spacing.sm,
        borderRadius: radii.lg,
        backgroundColor: palette.glass.accent,
        borderWidth: 1,
        borderColor: palette.border.accent,
    },
    previewBody: { flex: 1, gap: 2 },
    stateCard: {
        alignItems: 'center',
        gap: spacing.xs,
        padding: spacing.md,
        borderRadius: radii.lg,
        backgroundColor: palette.glass.elevated,
        borderWidth: 1,
        borderColor: palette.border.subtle,
    },
    stateTitle: {
        color: palette.text.primary,
        fontSize: 15,
        fontWeight: '700',
        textAlign: 'center',
    },
    stateText: { textAlign: 'center' },
    rowButtons: { flexDirection: 'row', gap: spacing.xs, alignSelf: 'stretch' },
    grow: { flex: 1 },
    linkButton: { paddingVertical: spacing.xxs, paddingHorizontal: spacing.xs },
    linkText: {
        color: palette.primary[600],
        fontSize: 13,
        fontWeight: '700',
    },
    pressed: { opacity: 0.6 },
    error: { color: palette.semantic.danger, textAlign: 'center' },
});
