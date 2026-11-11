import * as Linking from 'expo-linking';
import {
    DEFAULT_INVITE_CREATE_INPUT,
    inviteCreatedByLabel,
    inviteCodeFromUrl,
    inviteExpiryLabel,
    inviteLinksQueryKey,
    inviteLinkUrl,
    inviteShareMessage,
    inviteStatusLabel,
    inviteUsesLabel,
    parseInviteInput,
    relativeTimeLabel,
    splitInviteLinks,
    splitLinkifiedText,
} from './invite-links-model';
import type { InviteLinkDto } from './invite-links-model';

jest.mock('expo-linking', () => ({
    createURL: (path: string) => `niazchat://${path}`,
}));

const NOW = Date.parse('2026-11-11T12:00:00.000Z');
const CODE = 'kQ3v8m2Xy7pLr4Tz1aBcDe';

function link(overrides: Partial<InviteLinkDto> = {}): InviteLinkDto {
    return {
        id: 1,
        code: CODE,
        status: 'active',
        createdBy: { userId: 42, name: 'Sara' },
        createdAt: '2026-11-11T10:00:00.000Z',
        expiresAt: null,
        maxUses: null,
        usesCount: 0,
        revokedAt: null,
        ...overrides,
    };
}

describe('parseInviteInput', () => {
    it('accepts a bare 22-character code and trims whitespace', () => {
        expect(parseInviteInput(CODE)).toBe(CODE);
        expect(parseInviteInput(`  ${CODE}\n`)).toBe(CODE);
    });

    it('accepts full links with trailing slash, query and fragment', () => {
        expect(parseInviteInput(`https://x.test/join/${CODE}`)).toBe(CODE);
        expect(parseInviteInput(`https://x.test/join/${CODE}/`)).toBe(CODE);
        expect(parseInviteInput(`https://x.test/join/${CODE}?utm=1`)).toBe(
            CODE,
        );
        expect(parseInviteInput(`https://x.test/join/${CODE}/#top`)).toBe(CODE);
        expect(parseInviteInput(`niazchat://join/${CODE}`)).toBe(CODE);
        expect(parseInviteInput(`exp://192.168.1.2:8081/--/join/${CODE}`)).toBe(
            CODE,
        );
    });

    it('finds the code inside surrounding text', () => {
        expect(
            parseInviteInput(`Join us here: https://x.test/join/${CODE}.`),
        ).toBe(CODE);
        expect(parseInviteInput(`code ${CODE} thanks`)).toBe(CODE);
    });

    it('rejects empty, wrong lengths and code-looking tokens', () => {
        expect(parseInviteInput('')).toBeNull();
        expect(parseInviteInput('   ')).toBeNull();
        expect(parseInviteInput(CODE.slice(0, 21))).toBeNull();
        expect(parseInviteInput(`${CODE}x`)).toBeNull();
        expect(parseInviteInput('deadbeef'.repeat(4))).toBeNull();
        expect(
            parseInviteInput(`https://x.test/join/${CODE.slice(0, 21)}`),
        ).toBeNull();
        expect(parseInviteInput('https://x.test/join/')).toBeNull();
    });
});

describe('inviteLinkUrl', () => {
    it('builds the router path through expo-linking', () => {
        expect(inviteLinkUrl(CODE)).toBe(`niazchat://join/${CODE}`);
        expect(Linking.createURL).toBeDefined();
    });
});

describe('splitLinkifiedText', () => {
    it('links only the URL in a message with surrounding text', () => {
        expect(
            splitLinkifiedText(`Join our group:\n${inviteLinkUrl(CODE)}`),
        ).toEqual([
            { type: 'text', text: 'Join our group:\n' },
            {
                type: 'link',
                text: `niazchat://join/${CODE}`,
                url: `niazchat://join/${CODE}`,
            },
        ]);
    });

    it('keeps every character when a message has several links', () => {
        const url = `https://x.test/join/${CODE}`;
        expect(
            splitLinkifiedText(`a ${url} b niazchat://join/${CODE} c`),
        ).toEqual([
            { type: 'text', text: 'a ' },
            { type: 'link', text: url, url },
            { type: 'text', text: ' b ' },
            {
                type: 'link',
                text: `niazchat://join/${CODE}`,
                url: `niazchat://join/${CODE}`,
            },
            { type: 'text', text: ' c' },
        ]);
    });

    it('does not link bare codes or ordinary words', () => {
        expect(splitLinkifiedText(`code ${CODE} thanks`)).toEqual([
            { type: 'text', text: `code ${CODE} thanks` },
        ]);
        expect(splitLinkifiedText('hello world')).toEqual([
            { type: 'text', text: 'hello world' },
        ]);
        expect(splitLinkifiedText('')).toEqual([]);
    });

    it('leaves sentence punctuation outside the link', () => {
        const url = `niazchat://join/${CODE}`;
        expect(splitLinkifiedText(`Tap ${url}.`)).toEqual([
            { type: 'text', text: 'Tap ' },
            { type: 'link', text: url, url },
            { type: 'text', text: '.' },
        ]);
        expect(splitLinkifiedText(`(see ${url})`)).toEqual([
            { type: 'text', text: '(see ' },
            { type: 'link', text: url, url },
            { type: 'text', text: ')' },
        ]);
    });

    it('preserves newlines and emoji in plain text segments', () => {
        expect(splitLinkifiedText('🎉 hi\nthere')).toEqual([
            { type: 'text', text: '🎉 hi\nthere' },
        ]);
    });

    it('reassembles to the exact original content', () => {
        for (const text of [
            '',
            'plain',
            `hi ${inviteLinkUrl(CODE)}!`,
            'a  b\n\nc 👀',
            `x https://example.com/invite/abc123. y`,
            `https://x.test/join/${CODE}`,
        ]) {
            expect(
                splitLinkifiedText(text)
                    .map((segment) => segment.text)
                    .join(''),
            ).toBe(text);
        }
    });
});

describe('inviteCodeFromUrl', () => {
    it('extracts the code from every supported link shape', () => {
        expect(inviteCodeFromUrl(inviteLinkUrl(CODE))).toBe(CODE);
        expect(inviteCodeFromUrl(`niazchat://join/${CODE}`)).toBe(CODE);
        expect(inviteCodeFromUrl(`exp://192.168.1.2:8081/--/join/${CODE}`)).toBe(
            CODE,
        );
        expect(inviteCodeFromUrl(`https://x.test/join/${CODE}`)).toBe(CODE);
        expect(inviteCodeFromUrl(`https://x.test/join/${CODE}/`)).toBe(CODE);
        expect(inviteCodeFromUrl(`https://x.test/join/${CODE}?utm=1`)).toBe(
            CODE,
        );
        expect(inviteCodeFromUrl(`https://x.test/invite/${CODE}`)).toBe(CODE);
    });

    it('rejects URLs without a valid code in the join path', () => {
        expect(inviteCodeFromUrl('')).toBeNull();
        expect(inviteCodeFromUrl('https://x.test/')).toBeNull();
        expect(inviteCodeFromUrl('https://x.test/join/')).toBeNull();
        expect(
            inviteCodeFromUrl(`https://x.test/join/${CODE.slice(0, 21)}`),
        ).toBeNull();
        expect(inviteCodeFromUrl(`https://x.test/g/${CODE}`)).toBeNull();
        expect(inviteCodeFromUrl(`niazchat://group/${CODE}`)).toBeNull();
    });
});

describe('relative labels', () => {
    it('formats future and past distances', () => {
        expect(relativeTimeLabel('2026-11-11T12:03:00.000Z', NOW)).toBe(
            'in 3 minutes',
        );
        expect(relativeTimeLabel('2026-11-11T11:00:00.000Z', NOW)).toBe(
            '1 hour ago',
        );
        expect(relativeTimeLabel('2026-11-11T11:59:40.000Z', NOW)).toBe(
            'just now',
        );
        expect(relativeTimeLabel('2026-12-12T12:00:00.000Z', NOW)).toBe(
            'in 1 month',
        );
    });

    it('formats expiry and usage', () => {
        expect(inviteExpiryLabel(null, NOW)).toBe('Never');
        expect(inviteExpiryLabel('2026-11-11T12:10:00.000Z', NOW)).toBe(
            'Expires in 10 minutes',
        );
        expect(inviteExpiryLabel('2026-11-11T11:00:00.000Z', NOW)).toBe(
            'Expired',
        );
        expect(inviteUsesLabel(link())).toBe('0 joined');
        expect(inviteUsesLabel(link({ usesCount: 2, maxUses: 10 }))).toBe(
            '2 / 10 used',
        );
        expect(inviteCreatedByLabel(link(), NOW)).toBe(
            'Created by Sara · 2 hours ago',
        );
        expect(
            inviteCreatedByLabel(
                link({ createdBy: { userId: null, name: '' } }),
                NOW,
            ),
        ).toBe('Created by Unknown · 2 hours ago');
    });

    it('labels every status', () => {
        expect(inviteStatusLabel('active')).toBe('Active');
        expect(inviteStatusLabel('expired')).toBe('Expired');
        expect(inviteStatusLabel('used_up')).toBe('Used up');
        expect(inviteStatusLabel('revoked')).toBe('Revoked');
    });
});

describe('page helpers', () => {
    it('splits active from inactive without reordering', () => {
        const active = link({ id: 2, code: `${CODE.slice(0, 21)}a` });
        const expired = link({ id: 3, status: 'expired' });
        const split = splitInviteLinks([active, expired]);
        expect(split.active.map((item) => item.id)).toEqual([2]);
        expect(split.inactive.map((item) => item.id)).toEqual([3]);
    });

    it('uses the documented query key and defaults', () => {
        expect(inviteLinksQueryKey(7)).toEqual(['group', 7, 'invite-links']);
        expect(DEFAULT_INVITE_CREATE_INPUT).toEqual({
            expiresInSeconds: null,
            maxUses: null,
        });
    });

    it('shares the URL and the bare code', () => {
        expect(inviteShareMessage('Team', CODE)).toBe(
            `Join "Team" on niazchat: niazchat://join/${CODE}\n${CODE}`,
        );
        expect(inviteShareMessage('', CODE)).toContain(
            'Join "this group" on niazchat',
        );
    });
});
