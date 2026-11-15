import { removePersistedCacheForUserId } from '../../core/query/query-persister';
import { closeAndDeleteUserDb } from './local-db';
import { resetMessagesMirrorState } from './messages-mirror';

/**
 * Local-first storage public surface.
 *
 * `clearAllLocalData` is the one call logout uses (and the future Settings
 * screen will): it removes that user's persisted query cache and deletes the
 * user's SQLite file. Media files (`media-cache`) are deliberately NOT cleared.
 */

export * from './local-db';
export * from './messages-reader';
export * from './messages-mirror';

/** Deletes one user's SQLite database (their AsyncStorage cache is separate). */
export async function clearUserLocalData(userId: number): Promise<void> {
    // Keep the cache subscription alive: it serves the NEXT user too.
    resetMessagesMirrorState();
    await closeAndDeleteUserDb(userId);
}

/** Removes the persisted query cache + SQLite database of one user. */
export async function clearAllLocalData(userId: number): Promise<void> {
    await removePersistedCacheForUserId(userId);
    await clearUserLocalData(userId);
}
