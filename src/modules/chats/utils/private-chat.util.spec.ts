import { TypeChatEnum } from 'src/common/enums/typeChat.enum';
import { isChatVisibleInList, pairKeyOf } from './private-chat.util';

describe('pairKeyOf', () => {
    it('is order independent', () => {
        expect(pairKeyOf(9, 3)).toBe('3:9');
        expect(pairKeyOf(3, 9)).toBe('3:9');
    });

    it('uses the same value from both sides of the same pair', () => {
        expect(pairKeyOf(42, 7)).toBe(pairKeyOf(7, 42));
    });

    it('rejects invalid ids', () => {
        expect(() => pairKeyOf(0, 3)).toThrow();
        expect(() => pairKeyOf(1.5, 3)).toThrow();
        expect(() => pairKeyOf(Number.NaN, 3)).toThrow();
    });
});

describe('isChatVisibleInList', () => {
    it('always shows groups', () => {
        expect(isChatVisibleInList(TypeChatEnum.GRUPE, false)).toBe(true);
    });

    it('hides an empty private chat and shows it after the first message', () => {
        expect(isChatVisibleInList(TypeChatEnum.PRIVATE, false)).toBe(false);
        expect(isChatVisibleInList(TypeChatEnum.PRIVATE, true)).toBe(true);
    });
});
