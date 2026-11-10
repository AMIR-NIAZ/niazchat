import {
    Injectable,
    Logger,
    OnModuleDestroy,
    OnModuleInit,
} from '@nestjs/common';
import { AttachmentService } from './attachment.service';
import { AttachmentConfig } from '../attachment.config';

/**
 * Periodic orphan cleanup. Runs on a plain interval (the project has no
 * @nestjs/schedule dependency) with an overlap guard: a slow pass can never
 * stack another one behind it. Failures are logged, never thrown.
 */
@Injectable()
export class AttachmentCleanupService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(AttachmentCleanupService.name);
    private timer: ReturnType<typeof setInterval> | null = null;
    private running = false;

    constructor(
        private readonly attachments: AttachmentService,
        private readonly config: AttachmentConfig,
    ) {}

    onModuleInit(): void {
        this.timer = setInterval((): void => {
            void this.runOnce();
        }, this.config.cleanupIntervalMs);
        // Never keep the process alive just for the cleanup job.
        this.timer.unref?.();
    }

    onModuleDestroy(): void {
        if (this.timer !== null) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    async runOnce(): Promise<void> {
        if (this.running) {
            return;
        }
        this.running = true;
        try {
            const orphans = await this.attachments.cleanupOrphans();
            const deleted =
                await this.attachments.cleanupDeletedMessageAttachments();
            if (orphans > 0 || deleted > 0) {
                this.logger.log(
                    `removed ${orphans} orphan upload(s) and ${deleted} attachment(s) of deleted messages`,
                );
            }
        } catch (error) {
            this.logger.error(
                `attachment cleanup failed: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
        } finally {
            this.running = false;
        }
    }
}
