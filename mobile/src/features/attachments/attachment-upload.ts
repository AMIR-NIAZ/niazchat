import { attachmentAuthHeaders } from './auth-headers';
import { chatAttachmentsUrl } from './attachment-url';
import type { LocalAttachment } from './validation';
import { MAX_CONCURRENT_UPLOADS } from './constants';

/** Multipart field the backend interceptor expects (and the app sends). */
export const ATTACHMENT_UPLOAD_FIELD = 'files';

/** A 100 MB video on a slow mobile link needs far more than two minutes. */
const UPLOAD_TIMEOUT_MS = 15 * 60_000;

/** Server response item returned by the upload route. */
export interface UploadedAttachment {
    id: number;
    originalName: string;
    mimeType: string;
    size: number;
    kind: 'image' | 'video' | 'voice' | 'file';
    width?: number;
    height?: number;
    duration?: number;
    hasPoster?: boolean;
    waveform?: number[];
}

interface UploadEnvelope {
    ok?: boolean;
    data?: UploadedAttachment[];
    message?: string | string[];
    statusCode?: number;
}

function serverMessageOf(body: UploadEnvelope | null): string | null {
    const raw = body?.message;
    const text = Array.isArray(raw) ? raw.join(', ') : raw;
    if (typeof text !== 'string' || text.trim() === '') {
        return null;
    }
    const trimmed = text.trim();
    return trimmed.length > 160 ? `${trimmed.slice(0, 157)}…` : trimmed;
}

/**
 * Short, user-facing reason for a failed upload. Never returns a generic
 * "upload failed" when the status is known; a 400 keeps the server's own
 * validation message (e.g. "file content is not a valid image").
 */
export function uploadFailureReason(
    status: number,
    body: UploadEnvelope | null,
    kind?: 'image' | 'video' | 'voice' | 'file',
): string {
    const server = serverMessageOf(body);
    if (status === 413) {
        return kind === 'voice' ? 'Voice message too large' : 'File too large';
    }
    if (status === 401) return 'Session expired';
    if (status === 403 || status === 404)
        return "You can't upload to this chat";
    if (status === 429) return server ?? 'Too many uploads. Try again.';
    if (status === 0) return 'No connection';
    if (status === 400) return server ?? 'Upload rejected';
    return server ?? `Upload failed (${status})`;
}

/** Dev-only diagnostics; never includes the token value. */
function logUploadFailure(
    url: string,
    file: LocalAttachment,
    status: number,
    responseText: string,
    hasAuth: boolean,
): void {
    const dev = (globalThis as { __DEV__?: boolean }).__DEV__ === true;
    if (!dev) return;
    console.warn('[attachments] upload failed', {
        url,
        method: 'POST',
        field: ATTACHMENT_UPLOAD_FIELD,
        authorization: hasAuth ? 'Bearer <redacted>' : 'none',
        contentType: 'multipart/form-data (automatic)',
        file: {
            uri: file.uri,
            name: file.name,
            type: file.mimeType,
            size: file.size,
        },
        status,
        response: responseText.slice(0, 500),
    });
}

/**
 * Uploads ONE file over HTTP with XMLHttpRequest (React Native `fetch` has no
 * upload progress). Multipart field `files`, no manual Content-Type. A 401
 * triggers exactly one refresh-and-retry through the existing token provider.
 */
export function uploadAttachment(
    chatId: number,
    file: LocalAttachment,
    options: {
        onProgress?: (progress: number) => void;
        signal?: AbortSignal;
        retriedAfterRefresh?: boolean;
        /** Appends `voice=1` (BEFORE the file part, see below). */
        voice?: boolean;
    } = {},
): Promise<UploadedAttachment> {
    return new Promise<UploadedAttachment>((resolve, reject) => {
        if (options.signal?.aborted === true) {
            reject(new Error('Upload cancelled.'));
            return;
        }

        const url = chatAttachmentsUrl(chatId);

        void attachmentAuthHeaders(options.retriedAfterRefresh === true)
            .then((headers) => {
                if (options.signal?.aborted === true) {
                    reject(new Error('Upload cancelled.'));
                    return;
                }

                const xhr = new XMLHttpRequest();
                const form = new FormData();
                // The text part MUST precede the file: multer only exposes
                // fields that arrive before a file part.
                if (options.voice === true) {
                    form.append('voice', '1');
                }
                form.append(ATTACHMENT_UPLOAD_FIELD, {
                    uri: file.uri,
                    name: file.name,
                    type: file.mimeType || 'application/octet-stream',
                } as unknown as Blob);

                let settled = false;
                let lastTick = 0;
                const cleanup = (): void => {
                    options.signal?.removeEventListener('abort', onAbort);
                };
                const finish = (action: () => void): void => {
                    if (settled) return;
                    settled = true;
                    cleanup();
                    action();
                };
                const onAbort = (): void => {
                    xhr.abort();
                    finish((): void => reject(new Error('Upload cancelled.')));
                };

                options.signal?.addEventListener('abort', onAbort);

                xhr.open('POST', url);
                xhr.timeout = UPLOAD_TIMEOUT_MS;
                if (headers !== undefined) {
                    xhr.setRequestHeader(
                        'Authorization',
                        headers['Authorization'] ?? '',
                    );
                }
                xhr.upload.onprogress = (event): void => {
                    if (event.lengthComputable && event.total > 0) {
                        const now = Date.now();
                        // At most ~10 progress updates per second.
                        if (
                            now - lastTick >= 100 ||
                            event.loaded === event.total
                        ) {
                            lastTick = now;
                            options.onProgress?.(
                                Math.min(1, event.loaded / event.total),
                            );
                        }
                    }
                };
                xhr.onerror = (): void => {
                    logUploadFailure(url, file, 0, '', headers !== undefined);
                    finish((): void => reject(new Error('No connection')));
                };
                xhr.ontimeout = (): void => {
                    logUploadFailure(
                        url,
                        file,
                        0,
                        'timeout',
                        headers !== undefined,
                    );
                    finish((): void => reject(new Error('Upload timed out')));
                };
                xhr.onload = (): void => {
                    let body: UploadEnvelope | null = null;
                    try {
                        body = JSON.parse(xhr.responseText) as UploadEnvelope;
                    } catch {
                        body = null;
                    }

                    if (
                        xhr.status === 401 &&
                        options.retriedAfterRefresh !== true
                    ) {
                        finish((): void => {
                            uploadAttachment(chatId, file, {
                                ...options,
                                retriedAfterRefresh: true,
                            }).then(resolve, reject);
                        });
                        return;
                    }

                    if (
                        xhr.status >= 200 &&
                        xhr.status < 300 &&
                        body?.ok === true
                    ) {
                        const uploaded = body.data?.[0];
                        if (uploaded === undefined) {
                            logUploadFailure(
                                url,
                                file,
                                xhr.status,
                                xhr.responseText,
                                headers !== undefined,
                            );
                            finish((): void =>
                                reject(
                                    new Error(
                                        'The server returned no attachment.',
                                    ),
                                ),
                            );
                            return;
                        }
                        finish((): void => resolve(uploaded));
                        return;
                    }

                    logUploadFailure(
                        url,
                        file,
                        xhr.status,
                        xhr.responseText,
                        headers !== undefined,
                    );
                    finish((): void =>
                        reject(
                            new Error(
                                uploadFailureReason(
                                    xhr.status || 0,
                                    body,
                                    file.kind,
                                ),
                            ),
                        ),
                    );
                };

                xhr.send(form);
            })
            .catch((error: unknown) => {
                reject(
                    error instanceof Error
                        ? error
                        : new Error('Could not start the upload.'),
                );
            });
    });
}

/**
 * Runs `worker` over `items` with a bounded number in flight. Results are
 * returned in input order (never thrown out of the pool).
 */
export async function mapWithConcurrency<T, R>(
    items: readonly T[],
    limit: number,
    worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
    const results = new Array<R>(items.length);
    let next = 0;
    const runners = Array.from(
        { length: Math.min(Math.max(1, limit), items.length) },
        async (): Promise<void> => {
            while (next < items.length) {
                const index = next;
                next += 1;
                results[index] = await worker(items[index]!, index);
            }
        },
    );
    await Promise.all(runners);
    return results;
}

export { MAX_CONCURRENT_UPLOADS };
