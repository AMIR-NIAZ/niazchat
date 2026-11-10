import { httpClient } from '../../core/api';
import type { AttachmentStreamUrlDto } from '../../core/api/dto/attachment.dto';

/**
 * Fresh, short-lived signed URL for the video player. The URL is bound to this
 * attachment and the current user and expires after ~10 minutes; players are
 * expected to request it again on a playback error.
 */
export async function fetchVideoStreamUrl(id: number): Promise<string> {
    const response = await httpClient.post<{
        ok: boolean;
        data: AttachmentStreamUrlDto;
    }>(`/attachments/${id}/stream-url`);
    const url = response.data?.data?.url;
    if (typeof url !== 'string' || url === '') {
        throw new Error('Could not prepare the video.');
    }
    return url;
}
