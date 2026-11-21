import { parseMentions } from './mentions';

describe('parseMentions', () => {
    it('finds a mention at the start of the text', () => {
        expect(parseMentions('@demo_ali hello')).toEqual([
            { type: 'mention', text: '@demo_ali', username: 'demo_ali' },
            { type: 'text', text: ' hello' },
        ]);
    });

    it('finds a mention after whitespace and a newline', () => {
        expect(parseMentions('hi @demo_ali')).toEqual([
            { type: 'text', text: 'hi ' },
            { type: 'mention', text: '@demo_ali', username: 'demo_ali' },
        ]);
        expect(parseMentions('hi\n@demo_ali')).toEqual([
            { type: 'text', text: 'hi\n' },
            { type: 'mention', text: '@demo_ali', username: 'demo_ali' },
        ]);
    });

    it('finds a mention after punctuation and keeps the punctuation', () => {
        expect(parseMentions('(@demo_ali),')).toEqual([
            { type: 'text', text: '(' },
            { type: 'mention', text: '@demo_ali', username: 'demo_ali' },
            { type: 'text', text: '),' },
        ]);
    });

    it('works in mixed Persian/English text', () => {
        expect(parseMentions('سلام @demo_ali، خوبی؟')).toEqual([
            { type: 'text', text: 'سلام ' },
            { type: 'mention', text: '@demo_ali', username: 'demo_ali' },
            { type: 'text', text: '، خوبی؟' },
        ]);
    });

    it('never treats an email address as a mention', () => {
        expect(parseMentions('a@b.com')).toEqual([
            { type: 'text', text: 'a@b.com' },
        ]);
        expect(parseMentions('user@demo_ali.com')).toEqual([
            { type: 'text', text: 'user@demo_ali.com' },
        ]);
    });

    it('never matches in the middle of a word', () => {
        expect(parseMentions('foo@demo_ali')).toEqual([
            { type: 'text', text: 'foo@demo_ali' },
        ]);
    });

    it('respects the backend length limits', () => {
        // 4 characters: below the backend minimum.
        expect(parseMentions('@demo')).toEqual([
            { type: 'text', text: '@demo' },
        ]);
        // 33 characters: above the backend maximum, no partial match either.
        const tooLong = `@a${'b'.repeat(32)}`;
        expect(parseMentions(tooLong)).toEqual([
            { type: 'text', text: tooLong },
        ]);
        // 32 characters is valid.
        const max = `@a${'b'.repeat(30)}c`;
        expect(parseMentions(max)).toEqual([
            { type: 'mention', text: max, username: max.slice(1) },
        ]);
    });

    it('rejects a username ending in an underscore', () => {
        expect(parseMentions('@demo_ali_')).toEqual([
            { type: 'text', text: '@demo_ali_' },
        ]);
    });

    it('returns an empty list for empty text', () => {
        expect(parseMentions('')).toEqual([]);
    });
});
