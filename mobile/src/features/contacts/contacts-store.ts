import { registerSessionCleanup } from '../../core/session/cleanup-registry';
import type { AddressBookIndex } from './contacts-device';

/**
 * In-memory only: the address book index never touches SecureStore, AsyncStorage
 * or the filesystem. It is dropped on logout through the session cleanup
 * registry (the query cache is cleared by `logout()` too).
 */

let addressBookIndex: AddressBookIndex | null = null;

export function getAddressBookIndex(): AddressBookIndex | null {
    return addressBookIndex;
}

export function setAddressBookIndex(next: AddressBookIndex): void {
    addressBookIndex = next;
}

export function clearAddressBookIndex(): void {
    addressBookIndex = null;
}

registerSessionCleanup(clearAddressBookIndex);
