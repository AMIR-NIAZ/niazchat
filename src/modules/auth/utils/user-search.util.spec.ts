import { BadRequestException } from '@nestjs/common';
import {
    escapeLikePattern,
    normalizeSearchLimit,
    normalizeUserSearch,
} from './user-search.util';

describe('normalizeUserSearch', () => {
    it('lowercases and strips a leading @', () => {
        expect(normalizeUserSearch('@Ali')).toBe('ali');
        expect(normalizeUserSearch('ALI')).toBe('ali');
        expect(normalizeUserSearch('  @ALI  ')).toBe('ali');
    });

    it('rejects queries shorter than 2 characters', () => {
        expect(() => normalizeUserSearch('a')).toThrow(BadRequestException);
        expect(() => normalizeUserSearch(' @a ')).toThrow(BadRequestException);
        expect(() => normalizeUserSearch('')).toThrow(BadRequestException);
        expect(() => normalizeUserSearch(undefined)).toThrow(
            BadRequestException,
        );
    });

    it('accepts exactly two characters', () => {
        expect(normalizeUserSearch('@a1')).toBe('a1');
    });
});

describe('escapeLikePattern', () => {
    it('escapes LIKE wildcards and the escape character itself', () => {
        expect(escapeLikePattern('a_b')).toBe('a\\_b');
        expect(escapeLikePattern('100%')).toBe('100\\%');
        expect(escapeLikePattern('a\\b')).toBe('a\\\\b');
    });

    it('leaves ordinary usernames untouched', () => {
        expect(escapeLikePattern('sara_1990')).toBe('sara\\_1990');
        expect(escapeLikePattern('sara1990')).toBe('sara1990');
    });
});

describe('normalizeSearchLimit', () => {
    it('defaults to 20 and caps at 20', () => {
        expect(normalizeSearchLimit(undefined)).toBe(20);
        expect(normalizeSearchLimit('5')).toBe(5);
        expect(normalizeSearchLimit('100')).toBe(20);
        expect(normalizeSearchLimit('-3')).toBe(20);
    });
});
