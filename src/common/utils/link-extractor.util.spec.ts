import {
    extractLinks,
    linkSnippet,
    normalizeLink,
} from './link-extractor.util';

describe('extractLinks', () => {
    it('finds http(s), www and bare hosts in first-seen order', () => {
        const links = extractLinks(
            'see https://Example.com/a?b=1 and www.foo.ir/x then bar.dev/path',
        );
        expect(links).toEqual([
            { url: 'https://Example.com/a?b=1', domain: 'example.com' },
            { url: 'https://www.foo.ir/x', domain: 'foo.ir' },
            { url: 'https://bar.dev/path', domain: 'bar.dev' },
        ]);
    });

    it('strips sentence punctuation and de-duplicates', () => {
        const links = extractLinks(
            '(https://example.com/x). Also https://example.com/x!',
        );
        expect(links).toHaveLength(1);
        expect(links[0]?.url).toBe('https://example.com/x');
    });

    it('ignores ordinary file names and abbreviations', () => {
        expect(extractLinks('report.pdf, e.g. this, version 1.2')).toEqual([]);
        expect(extractLinks(null)).toEqual([]);
        expect(extractLinks('   ')).toEqual([]);
    });

    it('keeps distinct paths and query strings separate', () => {
        const links = extractLinks(
            'https://example.com/a https://example.com/b',
        );
        expect(links.map((link) => link.url)).toEqual([
            'https://example.com/a',
            'https://example.com/b',
        ]);
    });
});

describe('normalizeLink', () => {
    it('rejects non-http schemes and hosts without a dot', () => {
        expect(normalizeLink('mailto:test@example.com')).toBeNull();
        expect(normalizeLink('localhost')).toBeNull();
    });

    it('lowercases the domain and drops a leading www', () => {
        expect(normalizeLink('WWW.Example.COM/Path')?.domain).toBe(
            'example.com',
        );
    });
});

describe('linkSnippet', () => {
    it('returns short bodies unchanged', () => {
        expect(linkSnippet('hello https://a.dev', 'a.dev')).toBe(
            'hello https://a.dev',
        );
    });

    it('cuts a long body around the domain with ellipses', () => {
        const content = `${'a '.repeat(200)}example.com${' b'.repeat(200)}`;
        const snippet = linkSnippet(content, 'example.com', 60);
        expect(snippet.length).toBeLessThanOrEqual(62);
        expect(snippet).toContain('example.com');
        expect(snippet.startsWith('…')).toBe(true);
        expect(snippet.endsWith('…')).toBe(true);
    });
});
