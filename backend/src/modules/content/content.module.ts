import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AffiliateModule } from '../affiliate/affiliate.module';
import { AgentsModule } from '../agents/agents.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { MediaModule } from '../media/media.module';
import { Organization } from '../organizations/entities/organization.entity';
import { OrganizationsModule } from '../organizations/organizations.module';
import { ContentController } from './content.controller';
import { ContentService } from './content.service';
import { ContentPostVersion } from './entities/content-post-version.entity';
import { ContentPost } from './entities/content-post.entity';
import { PostApproval } from './entities/post-approval.entity';
import { MockLlmProvider } from './providers/mock-llm.provider';
import { LLM_PROVIDER, LlmProvider } from './providers/llm-provider.types';
import { UnavailableLlmProvider } from './providers/unavailable-llm.provider';

@Module({
  imports: [
    TypeOrmModule.forFeature([ContentPost, ContentPostVersion, PostApproval, Organization]),
    OrganizationsModule, // cung cấp OrgAccessGuard
    AffiliateModule,
    MediaModule,
    AgentsModule,
    AuditLogsModule,
  ],
  controllers: [ContentController],
  providers: [
    {
      // LLM_PROVIDER=mock (mặc định) dùng bản nháp mẫu gắn nhãn [MẪU]; giá trị khác báo "chưa cấu hình".
      provide: LLM_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): LlmProvider =>
        (config.get<string>('LLM_PROVIDER') ?? 'mock') === 'mock'
          ? new MockLlmProvider()
          : new UnavailableLlmProvider(),
    },
    ContentService,
  ],
  exports: [ContentService],
})
export class ContentModule {}
