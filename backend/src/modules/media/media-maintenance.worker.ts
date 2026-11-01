import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { MediaMaintenanceService } from './media-maintenance.service';

export const MEDIA_MAINTENANCE_QUEUE = 'media-maintenance';
const RECHECK_EVERY_MS = 6 * 60 * 60_000;

@Processor(MEDIA_MAINTENANCE_QUEUE)
export class MediaMaintenanceProcessor extends WorkerHost {
  private readonly logger = new Logger(MediaMaintenanceProcessor.name);

  constructor(private readonly maintenance: MediaMaintenanceService) {
    super();
  }

  async process(): Promise<void> {
    const summary = await this.maintenance.recheckAllOrganizations();
    this.logger.log(`Quét giấy phép: ${summary.organizations} tổ chức, ${summary.checked} media, ${summary.changed} đổi, ${summary.failed} lỗi`);
  }
}

/** Đặt nhịp quét mỗi 6 giờ (cùng khóa nên chạy nhiều tiến trình vẫn chỉ có một lịch). */
@Injectable()
export class MediaMaintenanceScheduler implements OnModuleInit {
  constructor(
    @InjectQueue(MEDIA_MAINTENANCE_QUEUE) private readonly queue: Queue,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    if ((this.config.get<string>('APP_ROLE') ?? 'all') === 'api') {
      return;
    }
    await this.queue.add('recheck', {}, {
      repeat: { every: RECHECK_EVERY_MS },
      jobId: 'media-recheck',
      removeOnComplete: true,
      removeOnFail: 20,
    });
  }
}
