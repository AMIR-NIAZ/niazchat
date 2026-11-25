import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
    AppText,
    GlassBottomSheet,
    GlassInput,
    PrimaryButton,
    spacing,
} from '../../shared/components';
import { useThemedStyles } from '../../shared/theme';
import type { AppTheme } from '../../shared/theme';
import { dialog, toast } from '../../shared/dialog';
import { describeSavedContactError } from './contacts-api';
import { useRenameContact } from './use-contacts';

/**
 * Rename a saved contact. Kept as a small themed sheet because the dialog
 * system intentionally has no text input; an empty name clears the alias and
 * the account name is shown again.
 */
export function RenameContactSheet({
    visible,
    contactId,
    currentName,
    initialAlias,
    onClose,
}: {
    visible: boolean;
    contactId: number | null;
    currentName: string;
    initialAlias: string | null;
    onClose: () => void;
}): React.ReactElement {
    const styles = useThemedStyles(createStyles);
    const rename = useRenameContact();
    const [alias, setAlias] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect((): void => {
        if (visible) {
            setAlias(initialAlias ?? '');
        }
    }, [visible, initialAlias]);

    const handleSave = async (): Promise<void> => {
        if (contactId === null || saving) {
            return;
        }
        setSaving(true);
        try {
            await rename.mutateAsync({
                id: contactId,
                alias: alias.trim() === '' ? null : alias,
            });
            toast.show('Contact renamed', { tone: 'success' });
            onClose();
        } catch (error) {
            dialog.show({
                title: 'Could not rename contact',
                message: describeSavedContactError(error),
                tone: 'danger',
            });
        } finally {
            setSaving(false);
        }
    };

    return (
        <GlassBottomSheet
            visible={visible}
            onClose={onClose}
            title="Rename contact"
        >
            <View style={styles.body}>
                <AppText variant="caption">
                    Renaming only changes how this person appears in your
                    contacts, not their account name.
                </AppText>
                <GlassInput
                    label={`Name for ${currentName}`}
                    placeholder={currentName}
                    value={alias}
                    onChangeText={setAlias}
                    autoCapitalize="words"
                    maxLength={60}
                    accessibilityLabel="Contact name"
                />
                {alias.trim() === '' && (
                    <AppText variant="caption" style={styles.hint}>
                        Leave it empty to use the account name.
                    </AppText>
                )}
                <PrimaryButton
                    label="Save name"
                    onPress={(): void => {
                        void handleSave();
                    }}
                    loading={saving}
                />
            </View>
        </GlassBottomSheet>
    );
}

const createStyles = (theme: AppTheme) =>
    StyleSheet.create({
        body: { gap: spacing.sm },
        hint: { color: theme.colors.textMuted },
    });
