import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { MessageService } from 'src/common/services/message.service';

@Processor('otp')
export class OtpConsumer extends WorkerHost {
    constructor(private readonly messageService: MessageService) {
        super();
    }
    async process(job: Job): Promise<any> {
        await this.messageService.sendOtpCode(job.data);
    }
}
