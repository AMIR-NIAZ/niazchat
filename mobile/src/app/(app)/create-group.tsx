import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { z } from 'zod';
import {
  AppText,
  FormButton,
  FormField,
  Screen,
  palette,
  spacing,
  typography,
} from '../../shared/components';
import { useCreateGroup } from '../../features/chats';
import { describeLookupError, getMe, getUserByUsername } from '../../features/users';

/**
 * Group creation (`POST /chats/create`).
 *
 * Backend facts honored:
 * - Validation: title ≤ 20 chars. `members` is optional: the caller is the
 *   initial member/administrator, additional members are user ids (duplicates
 *   and the caller's own id are filtered server-side).
 * - Response contains NO chat id → the chats list is invalidated and refetched.
 * - There is no user-directory endpoint; members are resolved one by one via
 *   `GET /user/pv/:userName` (username lookup), so selection is lookup-based.
 */

const createSchema = z.object({
  title: z.string().min(1, 'Group name is required').max(20, 'Max 20 characters'),
  // Always an array (possibly empty) of STRING user ids (backend `@IsString({ each: true })`):
  // a group can be created with the creator as its only member, so no minimum-member
  // validation applies here.
  members: z.array(z.string()),
});

type CreateFormValues = z.infer<typeof createSchema>;

interface MemberChip {
  id: number;
  label: string;
}

export default function CreateGroupScreen(): React.ReactElement {
  const router = useRouter();
  const createGroup = useCreateGroup();
  const [usernameInput, setUsernameInput] = useState('');
  const [chips, setChips] = useState<MemberChip[]>([]);
  const [lookup, setLookup] = useState<{ pending: boolean; error: string | null }>({
    pending: false,
    error: null,
  });

  const {
    control,
    handleSubmit,
    setValue,
    getValues,
    formState: { errors },
  } = useForm<CreateFormValues>({
    resolver: zodResolver(createSchema),
    mode: 'onSubmit',
    defaultValues: { title: '', members: [] },
  });

  const addMemberByUsername = async (): Promise<void> => {
    if (lookup.pending) {
      return;
    }
    const username = usernameInput.trim();
    if (username === '') {
      setLookup({ pending: false, error: 'Enter a username first.' });
      return;
    }
    setLookup({ pending: true, error: null });
    try {
      const user = await getUserByUsername(username);
      const members = getValues('members') ?? [];
      if (members.indexOf(String(user.id)) !== -1) {
        setLookup({ pending: false, error: 'This user is already in the list.' });
        return;
      }
      setValue('members', [...members, String(user.id)]);
      setChips((current) => {
        const withoutClone = current.filter((chip) => chip.id !== user.id);
        return [...withoutClone, { id: user.id, label: `${user.name} (@${user.username ?? '—'})` }];
      });
      setUsernameInput('');
      setLookup({ pending: false, error: null });
    } catch (error) {
      setLookup({ pending: false, error: describeLookupError(error) });
    }
  };

  const removeMember = (id: number): void => {
    const members = getValues('members') ?? [];
    setValue(
      'members',
      members.filter((member) => member !== String(id)),
    );
    setChips((current) => current.filter((chip) => chip.id !== id));
  };

  const onSubmit = handleSubmit(async (values): Promise<void> => {
    // The creator is the initial member/administrator; exclude themselves from
    // the additional-members list (id as string — backend filters own id too).
    let members = values.members;
    try {
      const me = await getMe();
      members = members.filter((memberId) => memberId !== String(me.id));
    } catch {
      // `getme` failed — fall back to the raw list (backend still filters own id).
    }
    await createGroup.mutateAsync({ title: values.title, members });
    // The backend returns no chat id; the invalidated list will surface the
    // new group once the WS `getAllChats` refetch resolves.
    router.replace('/(app)');
  });

  return (
    <Screen style={styles.screen}>
      <AppText variant="title">New group</AppText>
      <AppText variant="caption">
        Members are optional — you will be the group's first member and
        administrator. Add others by looking up their username (no directory
        endpoint exists).
      </AppText>

      <Controller
        control={control}
        name="title"
        render={({ field: { onChange, onBlur, value } }): React.ReactElement => (
          <FormField
            label="Group name"
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            error={errors.title?.message ?? null}
            maxLength={20}
          />
        )}
      />

      <FormField
        label="Member username"
        value={usernameInput}
        onChangeText={(text): void => setUsernameInput(text)}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Text style={[typography.caption, styles.error]}>
        {errors.members?.message ?? lookup.error ?? ''}
      </Text>

      <Pressable
        onPress={(): void => {
          void addMemberByUsername();
        }}
        style={styles.addMember}
      >
        <Text style={styles.addMemberText}>
          {lookup.pending ? 'Looking up…' : 'Lookup & add (optional)'}
        </Text>
      </Pressable>

      {chips.length > 0 && (
        <View style={styles.chipsRow}>
          {chips.map((chip) => (
            <Pressable
              key={chip.id}
              accessibilityRole="button"
              style={styles.chip}
              onPress={(): void => removeMember(chip.id)}
            >
              <Text style={styles.chipText}>{chip.label} ×</Text>
            </Pressable>
          ))}
        </View>
      )}

      {createGroup.isError && (
        <Text style={[typography.caption, styles.error]}>{createGroup.error.message}</Text>
      )}

      <View style={styles.actions}>
        {createGroup.isPending ? (
          <ActivityIndicator />
        ) : (
          <FormButton
            label="Create group"
            onPress={(): void => {
              void onSubmit();
            }}
          />
        )}
        <FormButton
          label="Cancel"
          intent="secondary"
          onPress={(): void => {
            router.back();
          }}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { gap: spacing.sm, paddingHorizontal: spacing.lg },
  error: { color: palette.semantic.danger },
  addMember: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: palette.primary[500],
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  addMemberText: { color: palette.primary[600], fontSize: 13, fontWeight: '600' },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xxs },
  chip: {
    backgroundColor: palette.primary[100],
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  chipText: { color: palette.primary[700], fontSize: 12 },
  actions: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.md },
});
