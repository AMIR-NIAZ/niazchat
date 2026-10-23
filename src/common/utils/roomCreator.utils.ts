import { ChatId, UserId } from "../types/brands.type";

export const userRoom = (userId: UserId) => `user:${userId}`;
export const chatRoom = (chatId: ChatId) => `chat:${chatId}`;
