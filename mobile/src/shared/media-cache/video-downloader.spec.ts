/// <reference types="jest" />
/**
 * Store tests for the video downloader (run with the mobile jest config:
 * `npx jest -c jest.mobile.config.js mobile/src/shared/media-cache`).
 *
 * expo-file-system is replaced by an in-memory fake so the download pipeline
 * can be driven synchronously and its progress callbacks observed.
 */
jest.mock('expo-file-system', () => {
    const files = new Map<string, number>();
    const texts = new Map<string, string>();
    const dirs = new Set<string>();

    interface Plan {
        size: number;
        steps: Array<{ written: number; total: number }>;
    }
    let plan: Plan | null = null;

    class MockDirectory {
        uri: string;
        constructor(base: MockDirectory | string, name?: string) {
            const baseUri = typeof base === 'string' ? base : base.uri;
            this.uri = name === undefined ? baseUri : `${baseUri}/${name}`;
        }
        get name(): string {
            return this.uri.slice(this.uri.lastIndexOf('/') + 1);
        }
        get exists(): boolean {
            return dirs.has(this.uri);
        }
        create(): void {
            dirs.add(this.uri);
        }
        delete(): void {
            dirs.delete(this.uri);
            const prefix = `${this.uri}/`;
            for (const key of [...files.keys()]) {
                if (key.startsWith(prefix)) files.delete(key);
            }
            for (const key of [...texts.keys()]) {
                if (key.startsWith(prefix)) texts.delete(key);
            }
        }
        list(): Array<MockFile | MockDirectory> {
            const prefix = `${this.uri}/`;
            const items: Array<MockFile | MockDirectory> = [];
            for (const key of new Set([...files.keys(), ...texts.keys()])) {
                if (!key.startsWith(prefix)) continue;
                const rest = key.slice(prefix.length);
                if (rest.includes('/')) continue;
                items.push(new MockFile(key));
            }
            return items;
        }
    }

    class MockFile {
        uri: string;
        constructor(base: MockFile | MockDirectory | string, name?: string) {
            const baseUri = typeof base === 'string' ? base : base.uri;
            this.uri = name === undefined ? baseUri : `${baseUri}/${name}`;
        }
        static downloadFileAsync(
            _url: string,
            destination: MockFile,
            options?: {
                onProgress?: (data: {
                    bytesWritten: number;
                    totalBytes: number;
                }) => void;
            },
        ): Promise<string> {
            if (plan === null) return Promise.reject(new Error('no download plan'));
            for (const step of plan.steps) {
                options?.onProgress?.({
                    bytesWritten: step.written,
                    totalBytes: step.total,
                });
            }
            files.set(destination.uri, plan.size);
            return Promise.resolve(destination.uri);
        }
        get name(): string {
            return this.uri.slice(this.uri.lastIndexOf('/') + 1);
        }
        get exists(): boolean {
            return files.has(this.uri) || texts.has(this.uri);
        }
        get size(): number {
            return files.get(this.uri) ?? texts.get(this.uri)?.length ?? 0;
        }
        get lastModified(): number {
            return Date.now();
        }
        delete(): void {
            files.delete(this.uri);
            texts.delete(this.uri);
        }
        moveSync(target: MockFile): MockFile {
            const size = files.get(this.uri) ?? 0;
            files.delete(this.uri);
            files.set(target.uri, size);
            return target;
        }
        open(): {
            readBytes: (bytes: number) => Promise<Uint8Array>;
            writeBytes: (bytes: Uint8Array) => Promise<void>;
            close: () => void;
        } {
            const uri = this.uri;
            return {
                readBytes: (bytes: number): Promise<Uint8Array> =>
                    Promise.resolve(
                        new Uint8Array(Math.min(bytes, files.get(uri) ?? 0)),
                    ),
                writeBytes: (bytes: Uint8Array): Promise<void> => {
                    files.set(uri, (files.get(uri) ?? 0) + bytes.length);
                    return Promise.resolve();
                },
                close: (): void => undefined,
            };
        }
        textSync(): string {
            return texts.get(this.uri) ?? '';
        }
        writeSync(text: string): void {
            texts.set(this.uri, text);
        }
    }

    return {
        File: MockFile,
        Directory: MockDirectory,
        Paths: {
            document: new MockDirectory('file:///documents'),
            availableDiskSpace: 1024 * 1024 * 1024,
        },
        FileMode: { ReadOnly: 0, Append: 1 },
        __reset: (): void => {
            files.clear();
            texts.clear();
            dirs.clear();
            plan = null;
        },
        __setDownloadPlan: (next: Plan): void => {
            plan = next;
        },
    };
});

jest.mock('react-native', () => ({
    AppState: {
        addEventListener: jest.fn(() => ({ remove: jest.fn() })),
    },
}));

jest.mock('../../features/attachments/auth-headers', () => ({
    attachmentAuthHeaders: (): Promise<undefined> => Promise.resolve(undefined),
}));

jest.mock('../../features/attachments/attachment-url', () => ({
    attachmentUrl: (id: number): string =>
        `https://api.test/attachments/${id}/download`,
}));

import {
    getLocalVideoUri,
    getVideoDownloadSnapshot,
    resetVideoDownloaderForTests,
    startVideoDownload,
    subscribeVideoDownload,
} from './video-downloader';
import type { VideoDownloadSnapshot } from './video-downloader';

interface FileSystemMock {
    __reset: () => void;
    __setDownloadPlan: (plan: {
        size: number;
        steps: Array<{ written: number; total: number }>;
    }) => void;
}

const fileSystem: FileSystemMock = jest.requireMock('expo-file-system');

const ATTACHMENT = {
    id: 5,
    mimeType: 'video/mp4',
    name: 'clip.mp4',
    size: 100,
};

const OTHER_ATTACHMENT = {
    id: 6,
    mimeType: 'video/mp4',
    name: 'other.mp4',
    size: 100,
};

function snapshotsFor(id: number): VideoDownloadSnapshot[] {
    const list: VideoDownloadSnapshot[] = [];
    const attachment = id === 5 ? ATTACHMENT : OTHER_ATTACHMENT;
    subscribeVideoDownload(id, (): void => {
        list.push(getVideoDownloadSnapshot(attachment));
    });
    return list;
}

beforeEach((): void => {
    resetVideoDownloaderForTests();
    fileSystem.__reset();
});

describe('video download store', () => {
    it('subscribes before a download exists and notifies every transition', async () => {
        const snapshots = snapshotsFor(5);
        fileSystem.__setDownloadPlan({
            size: 100,
            steps: [
                { written: 30, total: 100 },
                { written: 60, total: 100 },
                { written: 100, total: 100 },
            ],
        });

        // The subscription exists before the first entry: this used to be a
        // no-op, so the UI never heard about queued/downloading/ready.
        await startVideoDownload(ATTACHMENT);

        const states = snapshots.map((snapshot) => snapshot.state);
        expect(states).toContain('queued');
        expect(states).toContain('downloading');
        expect(states).toContain('verifying');
        expect(states[states.length - 1]).toBe('ready');

        // A new immutable snapshot per change → new reference per notification.
        expect(new Set(snapshots).size).toBe(snapshots.length);

        const ready = snapshots[snapshots.length - 1];
        expect(ready?.progress).toBe(1);
        expect(ready?.receivedBytes).toBe(100);
        expect(ready?.localUri).not.toBeNull();
        expect(getLocalVideoUri(5)).toBe(ready?.localUri);
    });

    it('emits the final ready state even with a throttled progress update pending', async () => {
        const snapshots = snapshotsFor(5);
        fileSystem.__setDownloadPlan({
            size: 100,
            // No awaits between ticks: the 2nd/3rd tick only schedule the
            // ~100 ms throttle timer, which the ready transition must beat.
            steps: [
                { written: 30, total: 100 },
                { written: 60, total: 100 },
                { written: 100, total: 100 },
            ],
        });

        await startVideoDownload(ATTACHMENT);
        const countAfterDownload = snapshots.length;
        const downloading = snapshots.filter(
            (snapshot) => snapshot.state === 'downloading',
        );
        expect(
            downloading.some(
                (snapshot) => Math.abs(snapshot.progress - 0.3) < 0.005,
            ),
        ).toBe(true);
        // The pending tick is flushed with the transition (progress reaches 1).
        expect(downloading[downloading.length - 1]?.progress).toBe(1);

        // No stale progress notification may land after `ready`.
        await new Promise<void>((resolve): void => {
            setTimeout(resolve, 150);
        });
        expect(snapshots.length).toBe(countAfterDownload);
        expect(snapshots[snapshots.length - 1]?.state).toBe('ready');
    });

    it('refers to the same entry from a string id and a number id', async () => {
        fileSystem.__setDownloadPlan({
            size: 100,
            steps: [{ written: 100, total: 100 }],
        });
        await startVideoDownload(ATTACHMENT);

        const numeric = getVideoDownloadSnapshot(ATTACHMENT);
        const stringKeyed = getVideoDownloadSnapshot({
            ...ATTACHMENT,
            id: '5' as unknown as number,
        });
        expect(stringKeyed).toBe(numeric);
        expect(stringKeyed.state).toBe('ready');
    });

    it('reports a cached file as ready on the first synchronous read', async () => {
        fileSystem.__setDownloadPlan({
            size: 100,
            steps: [{ written: 100, total: 100 }],
        });
        await startVideoDownload(ATTACHMENT);

        // Simulate an app restart: in-memory entries are gone, the file and
        // its cache-index entry stayed on disk.
        resetVideoDownloaderForTests();

        const snapshot = getVideoDownloadSnapshot(ATTACHMENT);
        expect(snapshot.state).toBe('ready');
        expect(snapshot.progress).toBe(1);
        expect(snapshot.localUri).not.toBeNull();
    });

    it('stops notifying after unsubscribe', async () => {
        const received: string[] = [];
        const unsubscribe = subscribeVideoDownload(5, (): void => {
            received.push(getVideoDownloadSnapshot(ATTACHMENT).state);
        });
        unsubscribe();
        fileSystem.__setDownloadPlan({
            size: 100,
            steps: [{ written: 100, total: 100 }],
        });
        await startVideoDownload(ATTACHMENT);
        expect(received).toEqual([]);
    });
});
