import { describe, expect, it } from '@jest/globals';
import type { SavedContactItem } from '../contacts/contacts-model';
import type { AddMembersResult } from './group-model';
import {
    addMembersFeedback,
    buildAddContactOptions,
    chunkUserIds,
    failuresText,
    filterAddContactOptions,
    mergeAddMembersResults,
    publicUserIdLabel,
    selectedCountLabel,
    toggleContactSelection,
} from './add-members-model';

function contact(
    userId: number,
    name: string,
    alias: string | null = null,
    username: string | null = null,
): SavedContactItem {
    return {
        id: userId,
        userId,
        alias,
        name,
        username,
        avatarUrl: null,
        phone: null,
    };
}

describe('publicUserIdLabel', () => {
    it('shows only positive integer public ids', () => {
        expect(publicUserIdLabel(42)).toBe('42');
        expect(publicUserIdLabel(0)).toBeNull();
        expect(publicUserIdLabel(-3)).toBeNull();
        expect(publicUserIdLabel(4.5)).toBeNull();
        expect(publicUserIdLabel(null)).toBeNull();
        expect(publicUserIdLabel(undefined)).toBeNull();
    });
});

describe('buildAddContactOptions', () => {
    it('marks existing members, deduplicates and sorts by display name', () => {
        const rows = buildAddContactOptions(
            [
                contact(2, 'Zahra'),
                contact(1, 'Ali', 'Ali work'),
                contact(2, 'Zahra duplicate'),
            ],
            new Set([2]),
        );
        expect(rows.map((row) => row.userId)).toEqual([1, 2]);
        expect(rows[0]?.displayName).toBe('Ali work');
        expect(rows[1]?.isMember).toBe(true);
    });

    it('prefers the saved alias and keeps the account name for search', () => {
        const [row] = buildAddContactOptions(
            [contact(5, 'Sara Ahmadi', 'Sara (work)')],
            new Set(),
        );
        expect(row?.displayName).toBe('Sara (work)');
        expect(row?.accountName).toBe('Sara Ahmadi');
        const options = [row!];
        expect(filterAddContactOptions(options, 'ahmadi')).toHaveLength(1);
        expect(filterAddContactOptions(options, 'work')).toHaveLength(1);
        expect(filterAddContactOptions(options, '5')).toHaveLength(1);
    });
});

describe('selection', () => {
    it('toggles without mutating the input set', () => {
        const initial = new Set([1]);
        const next = toggleContactSelection(initial, 2);
        expect([...next]).toEqual([1, 2]);
        expect([...initial]).toEqual([1]);
        expect([...toggleContactSelection(next, 1)]).toEqual([2]);
    });

    it('labels the selected count', () => {
        expect(selectedCountLabel(0)).toBeNull();
        expect(selectedCountLabel(1)).toBe('1 selected');
        expect(selectedCountLabel(3)).toBe('3 selected');
    });
});

describe('batch helpers', () => {
    it('chunks at the server cap and merges responses', () => {
        expect(chunkUserIds([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
        const results: AddMembersResult[] = [
            { added: [], failed: [], membersCount: 0 },
            { added: [], failed: [], membersCount: 0 },
        ];
        expect(mergeAddMembersResults(results)).toEqual({
            added: [],
            failed: [],
            membersCount: 0,
        });
    });

    it('reports partial success and failure reasons', () => {
        expect(addMembersFeedback({ added: [1, 2], failed: [3] })).toBe(
            '2 added · 1 not added',
        );
        expect(addMembersFeedback({ added: [1], failed: [] })).toBe(
            '1 member added',
        );
        expect(
            failuresText([
                { userId: 1, code: 'already_member', message: '' },
                { userId: 2, code: 'already_member', message: '' },
                { userId: 3, code: 'banned', message: '' },
            ]),
        ).toBe('2 already in the group · 1 banned from the group');
    });
});
