import { httpClient } from '../../core/api';
import { leaveGroup } from './groups-service';

describe('leaveGroup', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('posts to the existing group-management leave route', async () => {
        const response = { message: 'you have left the group', chatId: 21 };
        const post = jest
            .spyOn(httpClient, 'post')
            .mockResolvedValue({ data: response } as never);

        await expect(leaveGroup(21)).resolves.toEqual(response);

        // `/chats/:chatId/leave` does not exist on the backend; a 404 there is
        // what made the app report a failed leave as "already left".
        expect(post).toHaveBeenCalledWith('/chats/manage/21/leave');
    });
});
