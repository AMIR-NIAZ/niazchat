import { PermissionChatEnum } from 'src/common/enums/permissionChat.enum';
import { RoleChatEnum } from 'src/common/enums/roleChat.enum';
import { TypeChatEnum } from 'src/common/enums/typeChat.enum';
import { canPinMessages, MessagePinCallerRules } from './message-pin.util';

describe('canPinMessages', () => {
    function rules(
        over: Partial<MessagePinCallerRules> = {},
    ): MessagePinCallerRules {
        return {
            chatType: TypeChatEnum.GRUPE,
            isChatBanned: false,
            roleName: RoleChatEnum.USER,
            isManager: false,
            isAdmin: false,
            permissions: [],
            ...over,
        };
    }

    it('allows both participants in a private chat', () => {
        expect(canPinMessages(rules({ chatType: TypeChatEnum.PRIVATE }))).toBe(
            true,
        );
        expect(
            canPinMessages(
                rules({
                    chatType: TypeChatEnum.PRIVATE,
                    roleName: RoleChatEnum.ADMIN,
                }),
            ),
        ).toBe(true);
    });

    it('always allows the group owner', () => {
        expect(
            canPinMessages(
                rules({
                    roleName: RoleChatEnum.MANAGER,
                    isManager: true,
                }),
            ),
        ).toBe(true);
    });

    it('gates admins on pin_message or all', () => {
        const admin = {
            roleName: RoleChatEnum.ADMIN,
            isAdmin: true,
        };
        expect(canPinMessages(rules(admin))).toBe(false);
        expect(
            canPinMessages(
                rules({
                    ...admin,
                    permissions: [PermissionChatEnum.PIN_MESSAGE],
                }),
            ),
        ).toBe(true);
        expect(
            canPinMessages(
                rules({
                    ...admin,
                    permissions: [PermissionChatEnum.ALL],
                }),
            ),
        ).toBe(true);
    });

    it('gates regular members on an explicit grant', () => {
        expect(canPinMessages(rules())).toBe(false);
        expect(
            canPinMessages(
                rules({ permissions: [PermissionChatEnum.PIN_MESSAGE] }),
            ),
        ).toBe(true);
    });

    it('rejects banned members and banned groups', () => {
        expect(canPinMessages(rules({ roleName: RoleChatEnum.BAN }))).toBe(
            false,
        );
        expect(
            canPinMessages(
                rules({
                    roleName: RoleChatEnum.MANAGER,
                    isManager: true,
                    isChatBanned: true,
                }),
            ),
        ).toBe(false);
    });
});
