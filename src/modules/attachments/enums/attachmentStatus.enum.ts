export enum AttachmentStatus {
    /** Uploaded through HTTP, waiting to be attached to a message. */
    PENDING = 'pending',
    /** Bound to a message; cannot be reused. */
    ATTACHED = 'attached',
}
