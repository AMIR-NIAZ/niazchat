import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    createContact,
    fetchSavedContacts,
    removeContact,
    renameContact,
} from './contacts-api';
import type { CreateContactPayload } from './contacts-api';
import type { SavedContactItem } from './contacts-model';

/**
 * Saved contacts (`GET /contacts`) with optimistic add/rename/remove.
 *
 * Every mutation snapshots the list, applies the change immediately and rolls
 * back on failure; the server list is refetched once the request settles so
 * ids and server-side defaults stay authoritative.
 */

export const CONTACTS_QUERY_KEY = ['contacts', 'saved'] as const;

const SAVED_CONTACTS_STALE_MS = 60_000;

export interface ContactPreview {
    userId: number;
    name: string;
    username: string | null;
    avatarUrl: string | null;
}

export interface AddContactVariables extends CreateContactPayload {
    /** The user shown in the "Find" step; enables an optimistic row. */
    preview?: ContactPreview;
}

interface AddContactContext {
    previous: SavedContactItem[] | undefined;
}

interface RenameContext {
    previous: SavedContactItem[] | undefined;
}

interface RemoveContext {
    previous: SavedContactItem[] | undefined;
}

export interface ContactsQuery {
    contacts: SavedContactItem[];
    isLoading: boolean;
    isRefreshing: boolean;
    error: Error | null;
    refetch: () => void;
}

export function useContacts(): ContactsQuery {
    const query = useQuery<SavedContactItem[]>({
        queryKey: CONTACTS_QUERY_KEY,
        queryFn: fetchSavedContacts,
        staleTime: SAVED_CONTACTS_STALE_MS,
    });
    return {
        contacts: query.data ?? [],
        isLoading: query.isPending,
        isRefreshing: query.isRefetching,
        error: query.error instanceof Error ? query.error : null,
        refetch: (): void => {
            void query.refetch();
        },
    };
}

/** Drops the app-only `preview` field before the request is sent. */
function toPayload(variables: AddContactVariables): CreateContactPayload {
    const payload: CreateContactPayload = {};
    if (variables.userId !== undefined) payload.userId = variables.userId;
    if (variables.username !== undefined) payload.username = variables.username;
    if (variables.phone !== undefined) payload.phone = variables.phone;
    if (variables.alias !== undefined) payload.alias = variables.alias;
    return payload;
}

export function useAddContact() {
    const queryClient = useQueryClient();
    return useMutation<
        SavedContactItem,
        Error,
        AddContactVariables,
        AddContactContext
    >({
        mutationFn: (variables) => createContact(toPayload(variables)),
        onMutate: async (variables): Promise<AddContactContext> => {
            await queryClient.cancelQueries({
                queryKey: CONTACTS_QUERY_KEY,
            });
            const previous =
                queryClient.getQueryData<SavedContactItem[]>(
                    CONTACTS_QUERY_KEY,
                );
            const preview = variables.preview;
            if (preview !== undefined) {
                const optimistic: SavedContactItem = {
                    id: -Date.now(),
                    userId: preview.userId,
                    alias:
                        variables.alias === undefined ||
                        variables.alias === null ||
                        variables.alias.trim() === ''
                            ? null
                            : variables.alias.trim(),
                    name: preview.name,
                    username: preview.username,
                    avatarUrl: preview.avatarUrl,
                    phone: variables.phone ?? null,
                };
                queryClient.setQueryData<SavedContactItem[]>(
                    CONTACTS_QUERY_KEY,
                    (current = []) => [optimistic, ...current],
                );
            }
            return { previous };
        },
        onError: (_error, _variables, context): void => {
            if (context?.previous !== undefined) {
                queryClient.setQueryData(CONTACTS_QUERY_KEY, context.previous);
            }
        },
        onSuccess: (item): void => {
            queryClient.setQueryData<SavedContactItem[]>(
                CONTACTS_QUERY_KEY,
                (current = []) => [
                    item,
                    ...current.filter(
                        (contact) =>
                            contact.id > 0 && contact.userId !== item.userId,
                    ),
                ],
            );
        },
        onSettled: (): void => {
            void queryClient.invalidateQueries({
                queryKey: CONTACTS_QUERY_KEY,
            });
        },
    });
}

export function useRenameContact() {
    const queryClient = useQueryClient();
    return useMutation<
        SavedContactItem,
        Error,
        { id: number; alias: string | null },
        RenameContext
    >({
        mutationFn: ({ id, alias }) => renameContact(id, alias),
        onMutate: async ({ id, alias }): Promise<RenameContext> => {
            await queryClient.cancelQueries({ queryKey: CONTACTS_QUERY_KEY });
            const previous =
                queryClient.getQueryData<SavedContactItem[]>(
                    CONTACTS_QUERY_KEY,
                );
            const trimmed = alias?.trim() ?? '';
            queryClient.setQueryData<SavedContactItem[]>(
                CONTACTS_QUERY_KEY,
                (current = []) =>
                    current.map((contact) =>
                        contact.id === id
                            ? {
                                  ...contact,
                                  alias: trimmed === '' ? null : trimmed,
                              }
                            : contact,
                    ),
            );
            return { previous };
        },
        onError: (_error, _variables, context): void => {
            if (context?.previous !== undefined) {
                queryClient.setQueryData(CONTACTS_QUERY_KEY, context.previous);
            }
        },
        onSuccess: (item): void => {
            queryClient.setQueryData<SavedContactItem[]>(
                CONTACTS_QUERY_KEY,
                (current = []) =>
                    current.map((contact) =>
                        contact.id === item.id ? item : contact,
                    ),
            );
        },
        onSettled: (): void => {
            void queryClient.invalidateQueries({
                queryKey: CONTACTS_QUERY_KEY,
            });
        },
    });
}

export function useRemoveContact() {
    const queryClient = useQueryClient();
    return useMutation<void, Error, number, RemoveContext>({
        mutationFn: (id) => removeContact(id),
        onMutate: async (id): Promise<RemoveContext> => {
            await queryClient.cancelQueries({ queryKey: CONTACTS_QUERY_KEY });
            const previous =
                queryClient.getQueryData<SavedContactItem[]>(
                    CONTACTS_QUERY_KEY,
                );
            queryClient.setQueryData<SavedContactItem[]>(
                CONTACTS_QUERY_KEY,
                (current = []) =>
                    current.filter((contact) => contact.id !== id),
            );
            return { previous };
        },
        onError: (_error, _id, context): void => {
            if (context?.previous !== undefined) {
                queryClient.setQueryData(CONTACTS_QUERY_KEY, context.previous);
            }
        },
        onSettled: (): void => {
            void queryClient.invalidateQueries({
                queryKey: CONTACTS_QUERY_KEY,
            });
        },
    });
}
