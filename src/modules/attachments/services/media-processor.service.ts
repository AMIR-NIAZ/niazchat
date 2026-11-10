import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import sharp from 'sharp';
import {
    MAX_CONCURRENT_MEDIA_PROCESSES,
    MAX_VIDEO_DIMENSION,
    MAX_VIDEO_DURATION_SECONDS,
    MAX_VOICE_DURATION_TOLERANCE_SECONDS,
    MEDIA_POSTER_TIMEOUT_MS,
    MEDIA_PROBE_TIMEOUT_MS,
    MEDIA_WAVEFORM_TIMEOUT_MS,
    POSTER_MAX_WIDTH,
    POSTER_WEBP_QUALITY,
    VIDEO_MIME_BY_EXT,
    VOICE_WAVEFORM_BUCKETS,
} from '../attachment.constants';

/** A file that ffprobe confirmed as a playable video container. */
export interface VideoProbeResult {
    mimeType: string;
    width: number;
    height: number;
    duration: number;
}

/** A file that ffprobe confirmed as an accepted voice container. */
export interface AudioProbeResult {
    mimeType: string;
    duration: number;
}

interface ProbeStream {
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
    duration?: string;
    tags?: Record<string, string>;
    disposition?: Record<string, number>;
    side_data_list?: Array<Record<string, unknown>>;
}

interface ProbeOutput {
    streams?: ProbeStream[];
    format?: {
        format_name?: string;
        duration?: string;
    };
}

const MAX_CAPTURE_BYTES = 1024 * 1024;

/**
 * Thin, bounded wrapper around ffprobe/ffmpeg.
 *
 * - Binaries are always spawned with an ARGUMENT ARRAY; no shell, and the only
 *   file argument is the server-generated storage path.
 * - Hard timeouts kill the child; stdout/stderr capture is capped.
 * - At most two media processes run at a time (the rest queue here).
 * - Availability is checked once at boot. When ffprobe is missing, video
 *   uploads must fail instead of storing unplayable files.
 */
@Injectable()
export class MediaProcessorService implements OnModuleInit {
    private readonly logger = new Logger(MediaProcessorService.name);
    private available = false;
    private active = 0;
    private readonly waiting: Array<() => void> = [];

    async onModuleInit(): Promise<void> {
        try {
            const result = await this.run('ffprobe', ['-version'], 5_000);
            this.available = result.code === 0;
        } catch {
            this.available = false;
        }
        if (!this.available) {
            this.logger.warn(
                'ffprobe/ffmpeg is not available in this environment: video uploads will fail with 503 until the image includes ffmpeg',
            );
        }
    }

    get isAvailable(): boolean {
        return this.available;
    }

    /**
     * Probes a stored file. Returns null when ffprobe cannot parse it, so the
     * caller can answer 400. A parseable non-video (audio-only, cover art,
     * unsupported container) returns `{ video: false }`.
     */
    async probe(
        filePath: string,
        extension: string,
    ): Promise<
        { video: false } | { video: true; result: VideoProbeResult } | null
    > {
        const probe = await this.runWithLimit(
            'ffprobe',
            [
                '-v',
                'error',
                '-print_format',
                'json',
                '-show_streams',
                '-show_format',
                filePath,
            ],
            MEDIA_PROBE_TIMEOUT_MS,
        );
        if (probe.code !== 0) {
            return null;
        }

        let parsed: ProbeOutput;
        try {
            parsed = JSON.parse(probe.stdout) as ProbeOutput;
        } catch {
            return null;
        }

        const streams = parsed.streams ?? [];
        const videoStream = streams.find(
            (stream) =>
                (stream.codec_type ?? '').toLowerCase() === 'video' &&
                Number(stream.disposition?.attached_pic ?? 0) !== 1,
        );
        if (videoStream === undefined) {
            return { video: false };
        }

        if (!isAcceptedContainer(parsed.format?.format_name, extension)) {
            return { video: false };
        }

        const dimensions = displayDimensions(videoStream);
        if (dimensions === null) {
            return { video: false };
        }

        const duration = Number(
            parsed.format?.duration ?? videoStream.duration,
        );
        if (!Number.isFinite(duration) || duration <= 0) {
            return { video: false };
        }

        if (
            dimensions.width > MAX_VIDEO_DIMENSION ||
            dimensions.height > MAX_VIDEO_DIMENSION
        ) {
            throw new VideoValidationError(
                `video dimensions exceed ${MAX_VIDEO_DIMENSION}px`,
            );
        }
        if (duration > MAX_VIDEO_DURATION_SECONDS) {
            throw new VideoValidationError('video is longer than 2 hours');
        }

        return {
            video: true,
            result: {
                mimeType: VIDEO_MIME_BY_EXT[extension] ?? 'video/mp4',
                width: dimensions.width,
                height: dimensions.height,
                duration: Math.round(duration * 10) / 10,
            },
        };
    }

    /**
     * Verifies a stored file as a voice recording. Never trusts the client
     * MIME/extension: the container and codec come from ffprobe. Returns null
     * for anything that is not an accepted voice container; a structurally
     * valid recording over the 11-minute tolerance throws
     * `VoiceValidationError` (HTTP 400).
     */
    async probeAudio(filePath: string): Promise<AudioProbeResult | null> {
        const probe = await this.runWithLimit(
            'ffprobe',
            [
                '-v',
                'error',
                '-print_format',
                'json',
                '-show_streams',
                '-show_format',
                filePath,
            ],
            MEDIA_PROBE_TIMEOUT_MS,
        );
        if (probe.code !== 0) {
            return null;
        }

        let parsed: ProbeOutput;
        try {
            parsed = JSON.parse(probe.stdout) as ProbeOutput;
        } catch {
            return null;
        }

        const streams = parsed.streams ?? [];
        const audioStream = streams.find(
            (stream) => (stream.codec_type ?? '').toLowerCase() === 'audio',
        );
        if (audioStream === undefined) {
            return null;
        }
        // Cover art is a video stream flagged `attached_pic`; a real video
        // stream (music video, screen recording) is never a voice message.
        const realVideoStream = streams.find(
            (stream) =>
                (stream.codec_type ?? '').toLowerCase() === 'video' &&
                Number(stream.disposition?.attached_pic ?? 0) !== 1,
        );
        if (realVideoStream !== undefined) {
            return null;
        }

        const duration = Number(
            parsed.format?.duration ?? audioStream.duration,
        );
        if (!Number.isFinite(duration) || duration <= 0) {
            return null;
        }
        if (duration > MAX_VOICE_DURATION_TOLERANCE_SECONDS) {
            throw new VoiceValidationError(
                'voice recording is longer than 10 minutes',
            );
        }

        const mimeType = voiceMimeOf(
            parsed.format?.format_name,
            audioStream.codec_name,
        );
        if (mimeType === null) {
            return null;
        }

        return {
            mimeType,
            duration: Math.round(duration * 10) / 10,
        };
    }

    /**
     * Decodes to mono 8 kHz signed 16-bit PCM on stdout (streamed, never the
     * whole file) and reduces it to 64 RMS bars (0..100). Any failure returns
     * null: the voice message is still accepted and the app draws flat bars.
     */
    async generateWaveform(filePath: string): Promise<number[] | null> {
        try {
            const samples = await this.decodePcm(filePath);
            if (samples === null || samples.length === 0) {
                return null;
            }
            return buildWaveform(samples, VOICE_WAVEFORM_BUCKETS);
        } catch (error) {
            this.logger.warn(
                `voice waveform generation failed: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
            return null;
        }
    }

    /**
     * Streams `ffmpeg -f s16le` output through the same process semaphore and
     * timeout as the other media jobs. PCM is capped at the 11-minute maximum
     * (8 kHz * 2 bytes), so memory stays bounded (~10 MB worst case).
     */
    private async decodePcm(filePath: string): Promise<Int16Array | null> {
        const maxBytes = (MAX_VOICE_DURATION_TOLERANCE_SECONDS + 5) * 8_000 * 2;

        await this.acquire();
        try {
            return await new Promise<Int16Array | null>((resolve, reject) => {
                const child = spawn(
                    'ffmpeg',
                    [
                        '-nostdin',
                        '-hide_banner',
                        '-loglevel',
                        'error',
                        '-i',
                        filePath,
                        '-vn',
                        '-ac',
                        '1',
                        '-ar',
                        '8000',
                        '-f',
                        's16le',
                        'pipe:1',
                    ],
                    { stdio: ['ignore', 'pipe', 'pipe'], shell: false },
                );
                const chunks: Buffer[] = [];
                let captured = 0;
                let stderr = '';
                let settled = false;
                const timer = setTimeout(() => {
                    if (settled) return;
                    settled = true;
                    child.kill('SIGKILL');
                    reject(
                        new Error(
                            `ffmpeg waveform timed out after ${MEDIA_WAVEFORM_TIMEOUT_MS}ms`,
                        ),
                    );
                }, MEDIA_WAVEFORM_TIMEOUT_MS);

                child.stdout.on('data', (chunk: Buffer) => {
                    if (settled || captured >= maxBytes) return;
                    const slice = chunk.subarray(
                        0,
                        Math.min(chunk.length, maxBytes - captured),
                    );
                    chunks.push(Buffer.from(slice));
                    captured += slice.length;
                });
                child.stderr.on('data', (chunk: Buffer) => {
                    if (stderr.length < 8_192) {
                        stderr += chunk.toString('utf8');
                    }
                });
                child.on('error', (error) => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    reject(error);
                });
                child.on('close', (code) => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    if (code !== 0) {
                        reject(
                            new Error(
                                `ffmpeg exited with ${String(code)}: ${stderr.slice(0, 300)}`,
                            ),
                        );
                        return;
                    }
                    resolve(toPcm(Buffer.concat(chunks)));
                });
            });
        } finally {
            this.release();
        }
    }

    /**
     * Extracts one frame at min(1 s, duration/2), downscales it and encodes a
     * WebP poster. Returns false on any failure (the video is still accepted).
     */
    async generatePoster(
        videoPath: string,
        posterPath: string,
        duration: number,
    ): Promise<boolean> {
        const seek = Math.max(0, Math.min(1, duration / 2));
        const temp = path.join(
            path.dirname(posterPath),
            `.poster-${process.pid}-${crypto.randomUUID()}.png`,
        );
        try {
            const frame = await this.runWithLimit(
                'ffmpeg',
                [
                    '-nostdin',
                    '-hide_banner',
                    '-loglevel',
                    'error',
                    '-y',
                    '-ss',
                    seek.toFixed(3),
                    '-i',
                    videoPath,
                    '-frames:v',
                    '1',
                    '-vf',
                    `scale=min(${POSTER_MAX_WIDTH}\\,iw):-2`,
                    '-f',
                    'image2',
                    temp,
                ],
                MEDIA_POSTER_TIMEOUT_MS,
            );
            if (frame.code !== 0) {
                this.logger.warn(
                    `poster frame extraction failed: ${frame.stderr.slice(0, 300)}`,
                );
                return false;
            }
            await fs.mkdir(path.dirname(posterPath), { recursive: true });
            await sharp(temp)
                .webp({ quality: POSTER_WEBP_QUALITY })
                .toFile(posterPath);
            return true;
        } catch (error) {
            this.logger.warn(
                `poster generation failed: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
            return false;
        } finally {
            await fs.rm(temp, { force: true }).catch((): void => undefined);
        }
    }

    private async runWithLimit(
        binary: string,
        args: string[],
        timeoutMs: number,
    ): Promise<{ code: number | null; stdout: string; stderr: string }> {
        await this.acquire();
        try {
            return await this.run(binary, args, timeoutMs);
        } finally {
            this.release();
        }
    }

    private acquire(): Promise<void> {
        if (this.active < MAX_CONCURRENT_MEDIA_PROCESSES) {
            this.active += 1;
            return Promise.resolve();
        }
        return new Promise<void>((resolve) => {
            this.waiting.push((): void => {
                this.active += 1;
                resolve();
            });
        });
    }

    private release(): void {
        this.active = Math.max(0, this.active - 1);
        this.waiting.shift()?.();
    }

    private run(
        binary: string,
        args: string[],
        timeoutMs: number,
    ): Promise<{ code: number | null; stdout: string; stderr: string }> {
        return new Promise((resolve, reject) => {
            const child = spawn(binary, args, {
                stdio: ['ignore', 'pipe', 'pipe'],
                shell: false,
            });
            let stdout = '';
            let stderr = '';
            let settled = false;
            const timer = setTimeout(() => {
                if (settled) return;
                child.kill('SIGKILL');
                reject(new Error(`${binary} timed out after ${timeoutMs}ms`));
            }, timeoutMs);

            child.stdout.on('data', (chunk: Buffer) => {
                if (stdout.length < MAX_CAPTURE_BYTES) {
                    stdout += chunk.toString('utf8');
                }
            });
            child.stderr.on('data', (chunk: Buffer) => {
                if (stderr.length < MAX_CAPTURE_BYTES) {
                    stderr += chunk.toString('utf8');
                }
            });
            child.on('error', (error) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                reject(error);
            });
            child.on('close', (code) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve({ code, stdout, stderr });
            });
        });
    }
}

/** ffprobe container names → the accepted client extensions. */
function isAcceptedContainer(
    formatName: string | undefined,
    extension: string,
): boolean {
    const name = (formatName ?? '').toLowerCase();
    switch (extension) {
        case 'webm':
            return name.includes('webm');
        case 'mov':
        case 'mp4':
        case 'm4v':
            return name.includes('mp4') || name.includes('mov');
        default:
            return false;
    }
}

/**
 * Display size with rotation applied. ffmpeg autorotates when encoding the
 * poster, so the stored width/height must be the display orientation too.
 */
function displayDimensions(
    stream: ProbeStream,
): { width: number; height: number } | null {
    const width = Number(stream.width);
    const height = Number(stream.height);
    if (
        !Number.isInteger(width) ||
        !Number.isInteger(height) ||
        width <= 0 ||
        height <= 0
    ) {
        return null;
    }
    const rotation = rotationOf(stream);
    return rotation === 90 || rotation === 270
        ? { width: height, height: width }
        : { width, height };
}

function rotationOf(stream: ProbeStream): number {
    let rotation = Number(stream.tags?.rotate);
    if (!Number.isFinite(rotation)) {
        for (const entry of stream.side_data_list ?? []) {
            const candidate = Number(entry.rotation);
            if (Number.isFinite(candidate)) {
                rotation = candidate;
                break;
            }
        }
    }
    if (!Number.isFinite(rotation)) return 0;
    const normalized = ((Math.round(rotation) % 360) + 360) % 360;
    return normalized;
}

/** Le audio container names → the accepted voice MIME types. */
function voiceMimeOf(
    formatName: string | undefined,
    codec: string | undefined,
): string | null {
    const format = (formatName ?? '').toLowerCase();
    const name = (codec ?? '').toLowerCase();
    if ((format.includes('mp4') || format.includes('mov')) && name === 'aac') {
        return 'audio/mp4';
    }
    if (format.includes('mp3') && name === 'mp3') {
        return 'audio/mpeg';
    }
    if (format.includes('ogg') && name === 'opus') {
        return 'audio/ogg';
    }
    if (
        (format.includes('matroska') || format.includes('webm')) &&
        name === 'opus'
    ) {
        return 'audio/webm';
    }
    return null;
}

/** Little-endian 16-bit PCM bytes → samples (a trailing odd byte is dropped). */
function toPcm(buffer: Buffer): Int16Array {
    const count = Math.floor(buffer.length / 2);
    const samples = new Int16Array(count);
    for (let index = 0; index < count; index += 1) {
        samples[index] = buffer.readInt16LE(index * 2);
    }
    return samples;
}

/**
 * Splits PCM into equal time buckets and returns the RMS of each bucket,
 * normalized to 0..100 with sqrt compression against the clip's own peak so a
 * quiet recording still has visible shape while silence stays at 0.
 */
export function buildWaveform(
    samples: Int16Array,
    buckets: number,
): number[] | null {
    if (samples.length === 0 || buckets <= 0) {
        return null;
    }
    const rms: number[] = [];
    let peak = 0;
    for (let bucket = 0; bucket < buckets; bucket += 1) {
        const start = Math.floor((bucket * samples.length) / buckets);
        const end = Math.max(
            start + 1,
            Math.floor(((bucket + 1) * samples.length) / buckets),
        );
        let sum = 0;
        let count = 0;
        for (
            let index = start;
            index < Math.min(end, samples.length);
            index += 1
        ) {
            const value = samples[index] ?? 0;
            sum += value * value;
            count += 1;
        }
        const value = count === 0 ? 0 : Math.sqrt(sum / count);
        rms.push(value);
        peak = Math.max(peak, value);
    }

    if (peak <= 0) {
        return rms.map(() => 0);
    }
    return rms.map((value) => {
        const compressed = Math.round(100 * Math.sqrt(value / peak));
        return Math.max(0, Math.min(100, compressed));
    });
}

/** Thrown for a structurally valid video with absurd metadata (HTTP 400). */
export class VideoValidationError extends Error {}

/** Thrown for a structurally valid voice recording over the limit (HTTP 400). */
export class VoiceValidationError extends Error {}
