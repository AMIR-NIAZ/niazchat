import { absoluteUploadUrl } from '../../core/config/env';
import type { ContactsMatchItemDto } from './contacts-service';

/**
 * Pure shaping for the Contacts tab.
 *
 * Two sources produce ONE alphabetical list:
 * - saved contacts (`/contacts`), which always win and keep their alias;
 * - device contacts matched to a registered account (`/contacts/match`),
 *   displayed with the name stored on the phone.
 */

/** A contact the user saved inside the app. */
export interface SavedContactItem {
    id: number;
    userId: number;
    alias: string | null;
    /** Account display name. */
    name: string;
    username: string | null;
    /** Absolute URL, null = initials. */
    avatarUrl: string | null;
    /** Present only when it was saved by phone. */
    phone: string | null;
}

/** A registered user found in the device address book. */
export interface MatchedContact {
    userId: number;
    /** Display name of the account on this app. */
    appName: string;
    username: string | null;
    /** Absolute thumbnail URL of the current photo, null = initials. */
    avatarUrl: string | null;
    /** Canonical E.164 number the caller uploaded. */
    phone: string;
    /** Name stored on the device for that number. */
    contactName: string;
}

/** One row of the merged list (a person appears exactly once). */
export interface ContactRow {
    key: string;
    userId: number;
    /** Alias → device name → account name, in that order. */
    displayName: string;
    appName: string;
    username: string | null;
    avatarUrl: string | null;
    saved: boolean;
    /** Saved-contact id, null for a device-only match. */
    savedContactId: number | null;
    fromDevice: boolean;
    deviceName: string | null;
}

export interface ContactSection {
    title: string;
    data: ContactRow[];
}

/** Persian-aware ordering: `Intl.Collator('fa')` sorts آ/ا/ب/پ… correctly. */
const collator = new Intl.Collator('fa', {
    sensitivity: 'base',
    numeric: true,
});

export function buildMatchedContacts(
    items: readonly ContactsMatchItemDto[],
    nameByPhone: ReadonlyMap<string, string>,
): MatchedContact[] {
    const seen = new Set<number>();
    const contacts: MatchedContact[] = [];
    for (const item of items) {
        const userId = Number(item.userId);
        if (!Number.isInteger(userId) || userId <= 0 || seen.has(userId)) {
            continue;
        }
        seen.add(userId);
        const avatar = item.avatars[0];
        contacts.push({
            userId,
            appName: item.name,
            username: item.username ?? null,
            avatarUrl: avatar === undefined ? null : absoluteUploadUrl(avatar),
            phone: item.phone,
            contactName: nameByPhone.get(item.phone) ?? item.name,
        });
    }
    return contacts;
}

export function savedContactKey(id: number): string {
    return `saved-${id}`;
}

/**
 * Merges both sources. Keyed by user id, so a person present in both appears
 * once: the saved contact wins and keeps its custom name.
 */
export function buildContactRows(
    saved: readonly SavedContactItem[],
    device: readonly MatchedContact[],
): ContactRow[] {
    const deviceByUserId = new Map<number, MatchedContact>();
    for (const match of device) {
        if (!deviceByUserId.has(match.userId)) {
            deviceByUserId.set(match.userId, match);
        }
    }

    const rows: ContactRow[] = [];
    const seen = new Set<number>();

    for (const contact of saved) {
        const userId = Number(contact.userId);
        if (!Number.isInteger(userId) || userId <= 0 || seen.has(userId)) {
            continue;
        }
        seen.add(userId);
        const match = deviceByUserId.get(userId) ?? null;
        rows.push({
            key: `contact-${userId}`,
            userId,
            displayName: contact.alias ?? match?.contactName ?? contact.name,
            appName: contact.name,
            username: contact.username,
            avatarUrl: contact.avatarUrl ?? match?.avatarUrl ?? null,
            saved: true,
            savedContactId: Number(contact.id),
            fromDevice: match !== null,
            deviceName: match?.contactName ?? null,
        });
    }

    for (const match of device) {
        if (seen.has(match.userId)) {
            continue;
        }
        seen.add(match.userId);
        rows.push({
            key: `contact-${match.userId}`,
            userId: match.userId,
            displayName: match.contactName,
            appName: match.appName,
            username: match.username,
            avatarUrl: match.avatarUrl,
            saved: false,
            savedContactId: null,
            fromDevice: true,
            deviceName: match.contactName,
        });
    }

    return sortContactRows(rows);
}

export function sortContactRows(rows: readonly ContactRow[]): ContactRow[] {
    return [...rows].sort((left, right) =>
        collator.compare(left.displayName, right.displayName),
    );
}

/** Latin letters get their own section; everything else is grouped under `#`. */
export function contactSectionTitle(name: string): string {
    const first = name.trim().charAt(0);
    return /^[A-Za-z]$/.test(first) ? first.toUpperCase() : '#';
}

/** Sorted sections: A–Z first, `#` last, each internally collator-sorted. */
export function buildContactSections(
    rows: readonly ContactRow[],
): ContactSection[] {
    const grouped = new Map<string, ContactRow[]>();
    for (const row of sortContactRows(rows)) {
        const title = contactSectionTitle(row.displayName);
        const bucket = grouped.get(title);
        if (bucket === undefined) {
            grouped.set(title, [row]);
        } else {
            bucket.push(row);
        }
    }
    const titles = [...grouped.keys()].sort((left, right) => {
        if (left === '#') return 1;
        if (right === '#') return -1;
        return left < right ? -1 : 1;
    });
    return titles.map((title) => ({ title, data: grouped.get(title) ?? [] }));
}

/** Local search across alias, device name, account name and username. */
export function filterContactRows(
    rows: readonly ContactRow[],
    query: string,
): ContactRow[] {
    const needle = query.trim().toLowerCase();
    if (needle === '') {
        return [...rows];
    }
    return rows.filter((row) => {
        return (
            row.displayName.toLowerCase().includes(needle) ||
            row.appName.toLowerCase().includes(needle) ||
            (row.deviceName ?? '').toLowerCase().includes(needle) ||
            (row.username ?? '').toLowerCase().includes(needle)
        );
    });
}

/** Subtitle under the name: username first, then a different account name. */
export function contactSubtitle(row: ContactRow): string | null {
    if (row.username !== null && row.username !== '') {
        return `@${row.username}`;
    }
    if (row.appName.trim() !== '' && row.appName !== row.displayName) {
        return row.appName;
    }
    return null;
}
