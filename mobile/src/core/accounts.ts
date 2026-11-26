import { accessTokenSubject } from '../features/auth/access-token-subject';
import {
    secureDelete,
    secureGet,
    secureKey,
    secureSet,
} from './storage/secure-kv';

/**
 * Multi-account session storage.
 *
 * Every account lives under its own SecureStore key and an ordered id list
 * names the saved accounts; the ACTIVE account is a separate key. One key per
 * account keeps each SecureStore value small (Android warns above ~2 KB) even
 * when three JWT pairs are stored.
 *
 * The backend has no logout endpoint, so removing an account (deleting its
 * tokens) IS the logout. The old single-token keys are migrated into the first
 * account on first read and then removed.
 */

export const MAX_ACCOUNTS = 3;

const ACCOUNT_KEYS_KEY = 'niazchat.accountIds.v1';
/** Per-account key namespace; the user id is appended through `secureKey`. */
const ACCOUNT_KEY_PREFIX = 'niazchat.account.v1';
const ACTIVE_ACCOUNT_KEY = 'niazchat.activeAccount.v1';
/** Pre-multi-account keys; read once for migration, then deleted. */
const LEGACY_ACCESS_TOKEN_KEY = 'niazchat.accessToken';
const LEGACY_REFRESH_TOKEN_KEY = 'niazchat.refreshToken';

export interface StoredAccount {
    userId: number;
    /** Display name; starts as the phone number until the profile loads. */
    name: string;
    username: string | null;
    /** Absolute avatar URL, or null when the account has no photo. */
    avatarUrl: string | null;
    accessToken: string;
    refreshToken: string;
    addedAt: string;
}

export interface NewAccountInput {
    userId: number;
    name: string;
    username?: string | null;
    avatarUrl?: string | null;
    accessToken: string;
    refreshToken: string;
}

export interface AccountProfile {
    name: string;
    username: string | null;
    avatarUrl: string | null;
}

export type AccountPatch = Partial<Omit<StoredAccount, 'userId' | 'addedAt'>>;

export class AccountLimitError extends Error {
    constructor() {
        super(`You can add up to ${MAX_ACCOUNTS} accounts.`);
        this.name = 'AccountLimitError';
    }
}

function isUserId(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function accountKey(userId: number): string {
    if (!isUserId(userId)) {
        throw new Error(
            `Cannot build an account key for user id ${String(userId)}.`,
        );
    }
    return secureKey(ACCOUNT_KEY_PREFIX, userId);
}

async function readIds(): Promise<number[]> {
    const raw = await secureGet(ACCOUNT_KEYS_KEY);
    if (raw === null) {
        return [];
    }
    try {
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            return [];
        }
        return [...new Set(parsed.filter(isUserId))];
    } catch {
        return [];
    }
}

async function writeIds(ids: readonly number[]): Promise<void> {
    await secureSet(ACCOUNT_KEYS_KEY, JSON.stringify(ids));
}

function parseAccount(raw: string | null): StoredAccount | null {
    if (raw === null) {
        return null;
    }
    try {
        const parsed: unknown = JSON.parse(raw);
        if (
            parsed === null ||
            typeof parsed !== 'object' ||
            Array.isArray(parsed)
        ) {
            return null;
        }
        const record = parsed as Record<string, unknown>;
        if (!isUserId(record['userId'])) {
            return null;
        }
        return {
            userId: record['userId'],
            name:
                typeof record['name'] === 'string' && record['name'] !== ''
                    ? record['name']
                    : `Account ${record['userId']}`,
            username:
                typeof record['username'] === 'string'
                    ? record['username']
                    : null,
            avatarUrl:
                typeof record['avatarUrl'] === 'string'
                    ? record['avatarUrl']
                    : null,
            accessToken:
                typeof record['accessToken'] === 'string'
                    ? record['accessToken']
                    : '',
            refreshToken:
                typeof record['refreshToken'] === 'string'
                    ? record['refreshToken']
                    : '',
            addedAt:
                typeof record['addedAt'] === 'string'
                    ? record['addedAt']
                    : new Date(0).toISOString(),
        };
    } catch {
        return null;
    }
}

async function writeAccount(account: StoredAccount): Promise<void> {
    await secureSet(accountKey(account.userId), JSON.stringify(account));
}

/**
 * Converts the pre-multi-account token pair into the first account. Runs once
 * per process; the legacy keys are deleted afterwards so this can never run
 * again (and a later logout cannot resurrect the old session).
 */
let migration: Promise<void> | null = null;
let migrated = false;

async function migrateLegacyTokens(): Promise<void> {
    if (migrated) {
        return;
    }
    migrated = true;

    const accessToken = await secureGet(LEGACY_ACCESS_TOKEN_KEY);
    const refreshToken = await secureGet(LEGACY_REFRESH_TOKEN_KEY);
    if (accessToken === null && refreshToken === null) {
        return;
    }

    const userId =
        accessTokenSubject(accessToken) ?? accessTokenSubject(refreshToken);
    if (userId !== null) {
        const ids = await readIds();
        if (!ids.includes(userId)) {
            await writeAccount({
                userId,
                name: `Account ${userId}`,
                username: null,
                avatarUrl: null,
                accessToken: accessToken ?? '',
                refreshToken: refreshToken ?? '',
                addedAt: new Date().toISOString(),
            });
            await writeIds([...ids, userId]);
        }
        await setActiveAccount(userId);
    }

    await secureDelete(LEGACY_ACCESS_TOKEN_KEY);
    await secureDelete(LEGACY_REFRESH_TOKEN_KEY);
}

function ensureMigrated(): Promise<void> {
    if (migration === null) {
        migration = migrateLegacyTokens().catch((): void => undefined);
    }
    return migration;
}

/** Saved accounts, in the order they were added. Corrupt entries are skipped. */
export async function getAccounts(): Promise<StoredAccount[]> {
    await ensureMigrated();
    const ids = await readIds();
    const accounts = await Promise.all(
        ids.map(
            async (userId): Promise<StoredAccount | null> =>
                parseAccount(await secureGet(accountKey(userId))),
        ),
    );
    return accounts.filter(
        (account): account is StoredAccount => account !== null,
    );
}

export async function getAccount(
    userId: number,
): Promise<StoredAccount | null> {
    await ensureMigrated();
    return parseAccount(await secureGet(accountKey(userId)));
}

/**
 * Adds a new account or refreshes an existing one (same user id = re-login).
 * Throws `AccountLimitError` when a NEW account would exceed the cap.
 */
export async function addAccount(
    input: NewAccountInput,
): Promise<StoredAccount> {
    await ensureMigrated();
    const ids = await readIds();
    const existing = await getAccount(input.userId);
    if (existing === null && ids.length >= MAX_ACCOUNTS) {
        throw new AccountLimitError();
    }

    const account: StoredAccount = {
        userId: input.userId,
        name: input.name,
        username: input.username ?? null,
        avatarUrl: input.avatarUrl ?? null,
        accessToken: input.accessToken,
        refreshToken: input.refreshToken,
        addedAt: existing?.addedAt ?? new Date().toISOString(),
    };
    await writeAccount(account);

    if (existing === null) {
        await writeIds([...ids, input.userId]);
    }
    return account;
}

/** Merges a partial update (tokens, name, avatar) into a stored account. */
export async function updateAccount(
    userId: number,
    patch: AccountPatch,
): Promise<StoredAccount | null> {
    const existing = await getAccount(userId);
    if (existing === null) {
        return null;
    }
    const next: StoredAccount = {
        ...existing,
        ...patch,
        userId: existing.userId,
        addedAt: existing.addedAt,
    };
    await writeAccount(next);
    return next;
}

/** Updates the display fields from the freshly loaded `GET /auth/getme`. */
export async function updateAccountProfile(
    userId: number,
    profile: AccountProfile,
): Promise<void> {
    const existing = await getAccount(userId);
    if (
        existing !== null &&
        existing.name === profile.name &&
        existing.username === profile.username &&
        existing.avatarUrl === profile.avatarUrl
    ) {
        return;
    }
    await updateAccount(userId, profile);
}

/**
 * Deletes one account and its tokens. When it was active the active pointer is
 * cleared too; the caller decides which account (if any) becomes active next
 * (an unset pointer falls back to the first saved account on the next read).
 */
export async function removeAccount(userId: number): Promise<void> {
    await ensureMigrated();
    const ids = await readIds();
    const activeRaw = await secureGet(ACTIVE_ACCOUNT_KEY);
    await secureDelete(accountKey(userId));
    await writeIds(ids.filter((id) => id !== userId));
    if (activeRaw !== null && Number(activeRaw) === userId) {
        await secureDelete(ACTIVE_ACCOUNT_KEY);
    }
}

/**
 * Id of the active account. A stale/missing pointer falls back to the first
 * saved account and is repaired, so an interrupted write cannot lock the app.
 */
export async function getActiveAccountId(): Promise<number | null> {
    await ensureMigrated();
    const ids = await readIds();
    if (ids.length === 0) {
        await secureDelete(ACTIVE_ACCOUNT_KEY);
        return null;
    }
    const raw = await secureGet(ACTIVE_ACCOUNT_KEY);
    const activeId = raw === null ? null : Number(raw);
    if (activeId !== null && ids.includes(activeId)) {
        return activeId;
    }
    const fallback = ids[0] ?? null;
    if (fallback !== null) {
        await secureSet(ACTIVE_ACCOUNT_KEY, String(fallback));
    }
    return fallback;
}

export async function getActiveAccount(): Promise<StoredAccount | null> {
    const userId = await getActiveAccountId();
    return userId === null ? null : getAccount(userId);
}

export async function setActiveAccount(userId: number): Promise<void> {
    await secureSet(ACTIVE_ACCOUNT_KEY, String(userId));
}
