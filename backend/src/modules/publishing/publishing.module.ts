import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DevOnlyGuard } from '../../common/guards/dev-only.guard';
import { AffiliateModule } from '../affiliate/affiliate.module';
import { AgentsModule } from '../agents/agents.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ContentPost } from '../content/entities/content-post.entity';
import { PostApproval } from '../content/entities/post-approval.entity';
import { MediaModule } from '../media/media.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { PublishJob } from './entities/publish-job.entity';
import { PublishedPost } from './entities/published-post.entity';
import { SocialAccount } from './entities/social-account.entity';
import { MockThreadsProvider } from './providers/mock-threads.provider';
import { THREADS_PROVIDER, ThreadsProvider } from './providers/threads-provider.types';
import { UnavailableThreadsProvider } from './providers/unavailable-threads.provider';
import { PublishingController, SocialAccountsController } from './publishing.controller';
import { PublishingService } from './publishing.service';
import { PUBLISHING_QUEUE, PublishingProcessor, PublishingTickScheduler } from './publishing.worker';

@Module({
  imports: [
    TypeOrmModule.forFeature([SocialAccount, PublishJob, PublishedPost, ContentPost, PostApproval]),
    BullModule.registerQueue({ name: PUBLISHING_QUEUE }),
    OrganizationsModule,
    AffiliateModule,
    MediaModule,
    AgentsModule,
    AuditLogsModule,
  ],
  controllers: [SocialAccountsController, PublishingController],
  providers: [
    {
      // THREADS_PROVIDER=mock (mặc định): đăng giả, không gọi mạng. Giá trị khác: từ chối rõ ràng vì chưa có tích hợp thật.
      provide: THREADS_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): ThreadsProvider =>
        (config.get<string>('THREADS_PROVIDER') ?? 'mock') === 'mock' ? new MockThreadsProvider() : new UnavailableThreadsProvider(),
    },
    PublishingService,
    PublishingProcessor,
    PublishingTickScheduler,
    DevOnlyGuard,
  ],
  exports: [PublishingService],
})
export class PublishingModule {}
