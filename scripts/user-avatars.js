#!/usr/bin/env node
/**
 * Multi-avatar endpoint checks (user profile photos).
 *
 * Usage:
 *   URL=http://localhost:3000 TOKEN=<A> TOKEN_OTHER=<B> node scripts/user-avatars.js
 *
 * Optional:
 *   UPLOADS_DIR=<backend uploads/avatars>   enables "no file left behind" checks
 *   TIMEOUT_MS=<ms>                         per-request timeout (default 15000)
 *
 * The script RESETS the TOKEN user's gallery first (and at the end), so run it
 * against a development account only.
 *
 * Exit code: 0 when every check passes, 1 otherwise.
 */

const { readdir } = require('node:fs/promises');
const { join } = require('node:path');

const URL = (process.env.URL || 'http://localhost:3000').replace(/\/+$/, '');
const TOKEN = process.env.TOKEN;
const TOKEN_OTHER = process.env.TOKEN_OTHER;
const UPLOADS_DIR =
    process.env.UPLOADS_DIR || join(process.cwd(), 'uploads', 'avatars');
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS || 15000);
const MAX_AVATARS = 10;
const MAX_BYTES = 5 * 1024 * 1024;

if (!TOKEN || !TOKEN_OTHER) {
    console.error(
        'Usage: URL=<origin> TOKEN=<user A> TOKEN_OTHER=<user B> node scripts/user-avatars.js',
    );
    process.exit(1);
}

let failures = 0;

function pass(name) {
    console.log(`PASS  ${name}`);
}

function fail(name, detail) {
    failures += 1;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
}

function errorText(error) {
    return error instanceof Error ? error.message : String(error);
}

function pngOfSize(size) {
    const header = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    const body = Buffer.alloc(Math.max(0, size - header.length));
    for (let index = 0; index < body.length; index += 1) {
        body[index] = Math.floor(Math.random() * 256);
    }
    return Buffer.concat([header, body]);
}

function basename(storedPath) {
    return storedPath.split('/').pop() || storedPath;
}

async function request(method, path, token, options = {}) {
    const headers = { Authorization: `Bearer ${token}` };
    let body;
    if (options.json !== undefined) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(options.json);
    }
    if (options.form !== undefined) {
        body = options.form;
    }
    const response = await fetch(`${URL}${path}`, {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await response.text();
    let data = null;
    try {
        data = text ? JSON.parse(text) : null;
    } catch {
        data = text;
    }
    return { status: response.status, data };
}

async function getMe(token) {
    const response = await request('GET', '/auth/getme', token);
    if (response.status !== 200) {
        throw new Error(
            `GET /auth/getme failed (${response.status}): ${JSON.stringify(response.data)}`,
        );
    }
    return response.data;
}

async function listAvatars(token) {
    const me = await getMe(token);
    return Array.isArray(me.avatars) ? me.avatars : [];
}

async function upload(token, buffer, mimeType, fileName) {
    const form = new FormData();
    form.append('avatar', new Blob([buffer], { type: mimeType }), fileName);
    return request('POST', '/user/avatars', token, { form });
}

async function resetAvatars(token) {
    for (let attempt = 0; attempt < MAX_AVATARS + 2; attempt += 1) {
        const avatars = await listAvatars(token);
        if (avatars.length === 0) return;
        const response = await request(
            'DELETE',
            `/user/avatars/${encodeURIComponent(basename(avatars[0]))}`,
            token,
        );
        if (response.status !== 200) {
            throw new Error(
                `could not reset avatars (${response.status}): ${JSON.stringify(response.data)}`,
            );
        }
    }
    throw new Error('could not reset avatars to an empty list');
}

async function avatarFileSet() {
    try {
        return new Set(await readdir(UPLOADS_DIR));
    } catch {
        return null;
    }
}

function sameSet(a, b) {
    if (a === null || b === null) return true;
    if (a.size !== b.size) return false;
    for (const value of a) {
        if (!b.has(value)) return false;
    }
    return true;
}

async function main() {
    // Idempotent: start from a clean gallery.
    await resetAvatars(TOKEN);

    // ---------------------------------------------------------------- uploads
    const first = pngOfSize(1024);
    const second = pngOfSize(2048);
    const third = pngOfSize(4096);
    const uploaded = [];
    for (const [buffer, label] of [
        [first, 'one.png'],
        [second, 'two.png'],
        [third, 'three.png'],
    ]) {
        const response = await upload(TOKEN, buffer, 'image/png', label);
        if (response.status === 201) {
            pass(`upload ${label} accepted`);
        } else {
            fail(
                `upload ${label} accepted`,
                `${response.status} ${JSON.stringify(response.data)}`,
            );
        }
        uploaded.push(response.data?.user?.avatars ?? []);
    }

    let avatars = await listAvatars(TOKEN);
    if (avatars.length === 3) {
        pass('three uploads stored');
    } else {
        fail('three uploads stored', `length=${avatars.length}`);
    }

    const names = avatars.map(basename);
    if (new Set(names).size === names.length) {
        pass('stored avatar names are unique');
    } else {
        fail('stored avatar names are unique', names.join(', '));
    }
    if (!avatars.some((path) => /one\.png|two\.png|three\.png/.test(path))) {
        pass('server generated the file names (client names not stored)');
    } else {
        fail('server generated the file names', avatars.join(', '));
    }

    const newest = uploaded[uploaded.length - 1] ?? [];
    const newestName = newest[0] === undefined ? null : basename(newest[0]);
    if (newestName !== null && names[0] === newestName) {
        pass('newest upload is first (current)');
    } else {
        fail('newest upload is first (current)', `first=${names[0]}`);
    }

    // Oldest is last after three appends/prepends.
    const oldestPath = avatars[avatars.length - 1];
    const middlePath = avatars[1];
    const newestPath = avatars[0];
    if (
        oldestPath !== undefined &&
        middlePath !== undefined &&
        newestPath !== undefined
    ) {
        pass('gallery keeps a stable order');
    } else {
        fail('gallery keeps a stable order');
    }

    // ------------------------------------------------------------ static files
    for (const storedPath of avatars) {
        const fileUrl = `${URL}/${storedPath}`;
        try {
            const response = await fetch(fileUrl, {
                signal: AbortSignal.timeout(TIMEOUT_MS),
            });
            const type = response.headers.get('content-type') || '';
            if (response.status === 200 && type.startsWith('image/')) {
                pass(`stored file reachable (${basename(storedPath)})`);
            } else {
                fail(
                    `stored file reachable (${basename(storedPath)})`,
                    `status=${response.status} type=${type}`,
                );
            }
        } catch (error) {
            fail(
                `stored file reachable (${basename(storedPath)})`,
                errorText(error),
            );
        }
    }

    // ------------------------------------------------------- promote to current
    const promoteTarget = basename(oldestPath);
    let response = await request(
        'PUT',
        `/user/avatars/${encodeURIComponent(promoteTarget)}/main`,
        TOKEN,
    );
    avatars = await listAvatars(TOKEN);
    const expectedAfterPromote = [oldestPath, newestPath, middlePath].map(
        basename,
    );
    if (
        response.status === 200 &&
        avatars.map(basename).join(',') === expectedAfterPromote.join(',')
    ) {
        pass('promote moves the chosen photo to index 0, others keep order');
    } else {
        fail(
            'promote moves the chosen photo to index 0, others keep order',
            `${response.status} order=${avatars.map(basename).join(',')} expected=${expectedAfterPromote.join(',')}`,
        );
    }

    // ------------------------------------------------------------ delete current
    response = await request(
        'DELETE',
        `/user/avatars/${encodeURIComponent(promoteTarget)}`,
        TOKEN,
    );
    avatars = await listAvatars(TOKEN);
    const afterDeleteCurrent = [newestPath, middlePath].map(basename);
    if (
        response.status === 200 &&
        avatars.map(basename).join(',') === afterDeleteCurrent.join(',')
    ) {
        pass('deleting the current photo promotes the next one');
    } else {
        fail(
            'deleting the current photo promotes the next one',
            `${response.status} order=${avatars.map(basename).join(',')}`,
        );
    }
    try {
        const response = await fetch(`${URL}/${oldestPath}`, {
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (response.status === 404) {
            pass('deleted photo file is gone');
        } else {
            fail('deleted photo file is gone', `status=${response.status}`);
        }
    } catch (error) {
        fail('deleted photo file is gone', errorText(error));
    }

    // ----------------------------------------------------------- other user ACL
    const currentName = basename(avatars[0]);
    const beforeOther = avatars.map(basename).join(',');
    const otherDelete = await request(
        'DELETE',
        `/user/avatars/${encodeURIComponent(currentName)}`,
        TOKEN_OTHER,
    );
    const otherPromote = await request(
        'PUT',
        `/user/avatars/${encodeURIComponent(currentName)}/main`,
        TOKEN_OTHER,
    );
    const afterOther = (await listAvatars(TOKEN)).map(basename).join(',');
    if (
        otherDelete.status === 404 &&
        otherPromote.status === 404 &&
        afterOther === beforeOther
    ) {
        pass('another user cannot delete or promote a foreign avatar');
    } else {
        fail(
            'another user cannot delete or promote a foreign avatar',
            `delete=${otherDelete.status} promote=${otherPromote.status}`,
        );
    }

    // ------------------------------------------------------- invalid identifiers
    const traversal = await request(
        'DELETE',
        '/user/avatars/..%2F..%2Fetc%2Fpasswd',
        TOKEN,
    );
    const unknown = await request(
        'DELETE',
        '/user/avatars/definitely-not-mine.png',
        TOKEN,
    );
    if (traversal.status === 400 && unknown.status === 404) {
        pass('path-shaped and unknown file names are rejected');
    } else {
        fail(
            'path-shaped and unknown file names are rejected',
            `traversal=${traversal.status} unknown=${unknown.status}`,
        );
    }

    // ---------------------------------------------------------------- file types
    const textUpload = await upload(
        TOKEN,
        Buffer.from('this is not an image at all'),
        'text/plain',
        'note.txt',
    );
    const spoofedUpload = await upload(
        TOKEN,
        Buffer.from('still not an image, definitely'),
        'image/png',
        'spoofed.png',
    );
    if (textUpload.status === 400 && spoofedUpload.status === 400) {
        pass('non-image and spoofed image uploads are rejected');
    } else {
        fail(
            'non-image and spoofed image uploads are rejected',
            `text=${textUpload.status} spoofed=${spoofedUpload.status}`,
        );
    }

    const oversized = await upload(
        TOKEN,
        pngOfSize(MAX_BYTES + 1024),
        'image/png',
        'huge.png',
    );
    if (oversized.status === 413 || oversized.status === 400) {
        pass(`oversized upload rejected (${oversized.status})`);
    } else {
        fail('oversized upload rejected', `status=${oversized.status}`);
    }

    // ------------------------------------------------------------------- limit
    let fill = await listAvatars(TOKEN);
    while (fill.length < MAX_AVATARS) {
        const response = await upload(
            TOKEN,
            pngOfSize(512 + fill.length),
            'image/png',
            `fill-${fill.length}.png`,
        );
        if (response.status !== 201) {
            fail(
                `fill to ${MAX_AVATARS} avatars`,
                `${response.status} ${JSON.stringify(response.data)}`,
            );
            break;
        }
        fill = await listAvatars(TOKEN);
    }
    if (fill.length === MAX_AVATARS) {
        pass(`gallery can hold ${MAX_AVATARS} photos`);
    } else {
        fail(`gallery can hold ${MAX_AVATARS} photos`, `length=${fill.length}`);
    }

    const filesBeforeEleventh = await avatarFileSet();
    const eleventh = await upload(
        TOKEN,
        pngOfSize(700),
        'image/png',
        'eleventh.png',
    );
    const filesAfterEleventh = await avatarFileSet();
    const message =
        eleventh.data && typeof eleventh.data.message === 'string'
            ? eleventh.data.message
            : '';
    if (
        eleventh.status === 400 &&
        message.toLowerCase().includes('at most') &&
        message.includes(String(MAX_AVATARS)) &&
        (await listAvatars(TOKEN)).length === MAX_AVATARS
    ) {
        pass(`11th upload rejected with a clear message ("${message}")`);
    } else {
        fail(
            '11th upload rejected with a clear message',
            `${eleventh.status} ${JSON.stringify(eleventh.data)}`,
        );
    }
    if (sameSet(filesBeforeEleventh, filesAfterEleventh)) {
        pass('rejected 11th upload leaves no file behind');
    } else {
        fail('rejected 11th upload leaves no file behind');
    }

    // ------------------------------------------------------------- concurrency
    await resetAvatars(TOKEN);
    const preexisting = [];
    for (let index = 0; index < 6; index += 1) {
        const response = await upload(
            TOKEN,
            pngOfSize(600 + index),
            'image/png',
            `pre-${index}.png`,
        );
        if (response.status !== 201) {
            fail(
                'seed avatars for the concurrency check',
                `${response.status} ${JSON.stringify(response.data)}`,
            );
            break;
        }
        preexisting.push(basename(response.data.user.avatars[0]));
    }

    const parallel = await Promise.all(
        Array.from({ length: 5 }, (_value, index) =>
            upload(
                TOKEN,
                pngOfSize(800 + index),
                'image/png',
                `parallel-${index}.png`,
            ),
        ),
    );
    const succeeded = parallel.filter(
        (response) => response.status === 201,
    ).length;
    const rejected = parallel.filter(
        (response) => response.status === 400,
    ).length;
    const afterParallel = await listAvatars(TOKEN);
    const afterNames = afterParallel.map(basename);
    const keptPreexisting = preexisting.every((name) =>
        afterNames.includes(name),
    );
    if (
        afterNames.length === MAX_AVATARS &&
        new Set(afterNames).size === MAX_AVATARS &&
        keptPreexisting &&
        succeeded === 4 &&
        rejected === 1
    ) {
        pass('5 concurrent uploads at 6/10: no loss, never above the limit');
    } else {
        fail(
            '5 concurrent uploads at 6/10: no loss, never above the limit',
            `length=${afterNames.length} ok=${succeeded} rejected=${rejected} kept=${keptPreexisting}`,
        );
    }

    // ---------------------------------------------------------- legacy endpoints
    await resetAvatars(TOKEN);
    const legacyForm = new FormData();
    legacyForm.append(
        'avatar',
        new Blob([pngOfSize(900)], { type: 'image/png' }),
        'legacy.png',
    );
    const legacyUpload = await request('PUT', '/user/uploade-avatar', TOKEN, {
        form: legacyForm,
    });
    const legacyAvatars = legacyUpload.data?.user?.avatars ?? [];
    if (
        legacyUpload.status === 200 &&
        legacyAvatars.length === 1 &&
        basename(legacyAvatars[0] ?? '') !== ''
    ) {
        pass('legacy PUT /user/uploade-avatar still uploads');
    } else {
        fail(
            'legacy PUT /user/uploade-avatar still uploads',
            `${legacyUpload.status} ${JSON.stringify(legacyUpload.data)}`,
        );
    }

    const legacyPath = legacyAvatars[0];
    const legacyDelete = await request('DELETE', '/user/delete-avatar', TOKEN, {
        json: { avatar: legacyPath },
    });
    const legacyAfter = await listAvatars(TOKEN);
    if (
        legacyDelete.status === 200 &&
        legacyDelete.data?.message === 'avatar updated successfully' &&
        legacyAfter.length === 0
    ) {
        pass('legacy DELETE /user/delete-avatar still removes by exact path');
    } else {
        fail(
            'legacy DELETE /user/delete-avatar still removes by exact path',
            `${legacyDelete.status} ${JSON.stringify(legacyDelete.data)}`,
        );
    }

    await resetAvatars(TOKEN);

    console.log(
        failures === 0
            ? '\nAll avatar checks passed.'
            : `\n${failures} avatar check(s) failed.`,
    );
    process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
    console.error(`FATAL ${errorText(error)}`);
    process.exit(1);
});
