import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { PublishingService } from './publishing.service';

export const PUBLISHING_QUEUE = 'publishing';
const TICK_EVERY_MS = 30_000;

/** Mỗi 30 giây đăng các việc đã đến giờ. Nguồn sự thật là PostgreSQL; Redis chỉ làm nhịp đồng hồ nên mất Redis không mất lịch. */
@Processor(PUBLISHING_QUEUE)
export class PublishingProcessor extends WorkerHost {
  private readonly logger = new Logger(PublishingProcessor.name);

  constructor(private readonly publishing: PublishingService) {
    super();
  }

  async process(): Promise<void> {
    const { recovered, results } = await this.publishing.runDue();
    if (recovered > 0 || results.length > 0) {
      this.logger.log(`runDue: dọn ${recovered} việc treo, xử lý ${results.length} việc`);
    }
  }
}

@Injectable()
export class PublishingTickScheduler implements OnModuleInit {
  constructor(
    @InjectQueue(PUBLISHING_QUEUE) private readonly queue: Queue,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const role = this.config.get<string>('APP_ROLE') ?? 'all';
    if (role === 'api') {
      return;
    }
    await this.queue.add('tick', {}, {
      repeat: { every: TICK_EVERY_MS },
      jobId: 'publishing-tick',
      removeOnComplete: true,
      removeOnFail: 20,
    });
  }
}
