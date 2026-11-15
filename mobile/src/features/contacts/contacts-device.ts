import * as Contacts from 'expo-contacts/legacy';
import type { CountryCode } from 'libphonenumber-js';
import { hashPhoneList, normalizePhone } from './contacts-phone';

/**
 * Reads the address book in pages and turns it into `E.164 → local name`.
 *
 * - Only phone numbers and names are requested; emails, notes and photos are
 *   never read.
 * - Work is sliced with `InteractionManager.runAfterInteractions` between
 *   pages (and every few dozen contacts) so a 1000+ entry address book never
 *   blocks the UI thread.
 * - Nothing here is persisted; the caller holds it in memory only.
 */

const PAGE_SIZE = 500;
/** Contacts processed between two yields to the UI thread. */
const CONTACT_SLICE = 40;

export interface AddressBookIndex {
    /** Unique, normalized numbers (E.164) — the only upload payload. */
    phones: string[];
    /** Normalized number → the name stored on the device for it. */
    nameByPhone: Map<string, string>;
    /** Changes whenever the uploaded list changes; part of the query key. */
    hash: string;
}

/** Yields to the event loop so the UI thread can paint between slices. */
function nextFrame(): Promise<void> {
    return new Promise((resolve): void => {
        setTimeout(resolve, 0);
    });
}

function contactName(contact: Contacts.ExistingContact): string | null {
    const name = contact.name?.trim();
    if (name !== undefined && name !== '') {
        return name;
    }
    const parts = [contact.firstName, contact.lastName]
        .map((part) => part?.trim() ?? '')
        .filter((part) => part !== '');
    if (parts.length === 0) {
        return null;
    }
    return parts.join(' ');
}

export async function readAddressBook(
    region: CountryCode,
): Promise<AddressBookIndex> {
    const nameByPhone = new Map<string, string>();
    const unique = new Set<string>();

    let pageOffset = 0;
    let processed = 0;
    for (;;) {
        const page: Contacts.ContactResponse = await Contacts.getContactsAsync({
            fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Name],
            pageSize: PAGE_SIZE,
            pageOffset,
        });

        for (const contact of page.data) {
            const name = contactName(contact);
            for (const entry of contact.phoneNumbers ?? []) {
                const phone = normalizePhone(entry.number, region);
                if (phone === null) {
                    continue;
                }
                unique.add(phone);
                // First contact wins, so a duplicate number keeps one label.
                if (name !== null && !nameByPhone.has(phone)) {
                    nameByPhone.set(phone, name);
                }
            }
            processed += 1;
            if (processed % CONTACT_SLICE === 0) {
                await nextFrame();
            }
        }

        pageOffset += page.data.length;
        // Stop on an empty page, a short (last) page, or an explicit `false`.
        // `hasNextPage` is not always populated by every platform, so an
        // undefined value must not truncate the address book after page one.
        if (page.data.length === 0 || page.hasNextPage === false) {
            break;
        }
        if (page.hasNextPage !== true && page.data.length < PAGE_SIZE) {
            break;
        }
        await nextFrame();
    }

    const phones = [...unique];
    return { phones, nameByPhone, hash: hashPhoneList(phones) };
}

/** True when the platform can read contacts at all (false on web). */
export async function isContactsAvailable(): Promise<boolean> {
    try {
        return await Contacts.isAvailableAsync();
    } catch {
        return false;
    }
}
