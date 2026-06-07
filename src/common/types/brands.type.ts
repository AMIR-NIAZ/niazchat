type Brand<T, B> = T & {
    readonly _brand: B;
};

export type ChatId = Brand<number, 'ChatId'>;
export type UserId = Brand<number, 'UserId'>;
export type MessageId = Brand<number, 'MessageId'>;
export type ReactId = Brand<number, 'ReactId'>;
