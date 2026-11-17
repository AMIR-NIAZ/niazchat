/**
 * Service (`system`) message contract, shared by the membership services, the
 * serializers and the seeders.
 *
 * `content` always carries an English fallback sentence for clients that do
 * not know the action; `meta` is the machine-readable form the app renders.
 * Names are snapshots taken when the action happened, so renaming/deleting a
 * user later never rewrites history.
 */
export const SERVICE_MESSAGE_ACTIONS = [
    'member_joined',
    'member_joined_via_link',
    'member_added',
    'member_left',
    'member_banned',
    'member_removed',
] as const;

export type ServiceMessageAction = (typeof SERVICE_MESSAGE_ACTIONS)[number];

export interface ServiceMessageMeta {
    action: ServiceMessageAction;
    /** Who performed the action (for join/leave = the member themselves). */
    actorId: number;
    actorName: string;
    /** The member the action happened to. */
    targetId: number;
    targetName: string;
}

/** Runtime guard for rows stored before an action existed / malformed JSON. */
export function isServiceMessageAction(
    value: unknown,
): value is ServiceMessageAction {
    return (
        typeof value === 'string' &&
        (SERVICE_MESSAGE_ACTIONS as readonly string[]).includes(value)
    );
}
