/**
 * Attachment DTOs (docs/mobile-api/attachments.md).
 */

/** `POST /chats/:chatId/attachments` response (`AttachmentUploadResponse`). Field: `file`. */
export interface AttachmentUploadResponseDto {
  id: number;
  originalName: string;
  mimeType: string;
  size: number;
  chatId: number;
  createdAt: string;
}
