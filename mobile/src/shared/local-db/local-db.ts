import * as SQLite from 'expo-sqlite';

/**
 * One SQLite database per user (`niazchat-<userId>.db`), opened lazily and
 * reused for the process lifetime. The schema is versioned in `db_version`
 * and migrated forward; every entry point throws `LocalDbError` so callers can
 * fall back to the network instead of crashing.
 */

export const SCHEMA_VERSION = 1;

export class LocalDbError extends Error {
    constructor(
        message: string,
        readonly cause?: unknown,
    ) {
        super(message);
        this.name = 'LocalDbError';
    }
}

/** Upper bound of confirmed messages kept per chat. */
export const MAX_MESSAGES_PER_CHAT = 200;
/** Upper bound of chats whose messages are kept (LRU by last write). */
export const MAX_CACHED_CHATS = 100;

const openDatabases = new Map<number, Promise<SQLite.SQLiteDatabase>>();

export function userDbFileName(userId: number): string {
    return `niazchat-${userId}.db`;
}

const MIGRATIONS: readonly string[] = [
    // v1
    `CREATE TABLE IF NOT EXISTS messages (
        chatId INTEGER NOT NULL,
        id INTEGER NOT NULL,
        createdAtIso TEXT NOT NULL,
        json TEXT NOT NULL,
        PRIMARY KEY (chatId, id)
    );
    CREATE INDEX IF NOT EXISTS idx_messages_chat_desc ON messages (chatId, id DESC);
    CREATE TABLE IF NOT EXISTS chat_sync (
        chatId INTEGER PRIMARY KEY,
        newestId INTEGER,
        oldestId INTEGER,
        updatedAt TEXT NOT NULL
    );`,
];

async function migrate(db: SQLite.SQLiteDatabase): Promise<void> {
    await db.execAsync(
        'CREATE TABLE IF NOT EXISTS db_version (key TEXT PRIMARY KEY, value INTEGER NOT NULL);',
    );
    const row = await db.getFirstAsync<{ value: number }>(
        "SELECT value FROM db_version WHERE key = 'schema'",
    );
    const current = row?.value ?? 0;
    if (current >= SCHEMA_VERSION) {
        return;
    }
    await db.withTransactionAsync(async (): Promise<void> => {
        for (let version = current; version < SCHEMA_VERSION; version += 1) {
            const sql = MIGRATIONS[version];
            if (sql !== undefined) {
                await db.execAsync(sql);
            }
        }
        await db.runAsync(
            "INSERT OR REPLACE INTO db_version (key, value) VALUES ('schema', ?)",
            SCHEMA_VERSION,
        );
    });
}

/** Opens (and caches) the user's database, running migrations once. */
export function openUserDb(userId: number): Promise<SQLite.SQLiteDatabase> {
    const existing = openDatabases.get(userId);
    if (existing !== undefined) {
        return existing;
    }
    const opening = (async (): Promise<SQLite.SQLiteDatabase> => {
        const db = await SQLite.openDatabaseAsync(userDbFileName(userId));
        await migrate(db);
        return db;
    })().catch((error: unknown): never => {
        openDatabases.delete(userId);
        throw error instanceof LocalDbError
            ? error
            : new LocalDbError('Could not open the local database.', error);
    });
    openDatabases.set(userId, opening);
    return opening;
}

/** Closes and deletes the user's database (logout / account switch). */
export async function closeAndDeleteUserDb(userId: number): Promise<void> {
    const opening = openDatabases.get(userId);
    openDatabases.delete(userId);
    if (opening !== undefined) {
        try {
            const db = await opening;
            await db.closeAsync();
        } catch {
            // Already gone/unopenable: deletion below is still attempted.
        }
    }
    try {
        await SQLite.deleteDatabaseAsync(userDbFileName(userId));
    } catch {
        // Logout must always finish; a leftover file is isolated per user.
    }
}

export type UserDatabase = SQLite.SQLiteDatabase;
