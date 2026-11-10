/// <reference types="jest" />
import {
    isStaleSearchResponse,
    normalizeChatSearchQuery,
} from './chat-search-model';

describe('normalizeChatSearchQuery', () => {
    it('trims, strips one leading @ and lowercases', () => {
        expect(normalizeChatSearchQuery('@Ali')).toBe('ali');
        expect(normalizeChatSearchQuery('  ALI  ')).toBe('ali');
        expect(normalizeChatSearchQuery('a1')).toBe('a1');
    });

    it('returns null below two characters so no request is sent', () => {
        expect(normalizeChatSearchQuery('')).toBeNull();
        expect(normalizeChatSearchQuery('  ')).toBeNull();
        expect(normalizeChatSearchQuery('a')).toBeNull();
        expect(normalizeChatSearchQuery('@a')).toBeNull();
        expect(normalizeChatSearchQuery('@')).toBeNull();
    });
});

describe('isStaleSearchResponse', () => {
    it('drops answers that are not the newest request', () => {
        expect(isStaleSearchResponse(3, 4)).toBe(true);
        expect(isStaleSearchResponse(4, 4)).toBe(false);
    });
});
