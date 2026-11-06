type Brand<T, B> = T & {
    readonly _brand: B;
};

export type ChatId = Brand<number, 'ChatId'>;
export type UserId = Brand<number, 'UserId'>;
export type ProfileId = Brand<number, 'ProfileId'>;
export type MessageId = Brand<number, 'MessageId'>;
export type ReactId = Brand<number, 'ReactId'>;
export type AttachmentId = Brand<number, 'AttachmentId'>;
