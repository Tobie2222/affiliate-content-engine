import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AffiliateLink } from '../affiliate/entities/affiliate-link.entity';
import { Product } from '../affiliate/entities/product.entity';
import { AgentsModule } from '../agents/agents.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ContentPost } from '../content/entities/content-post.entity';
import { OrganizationsModule } from '../organizations/organizations.module';
import { PublishedPost } from '../publishing/entities/published-post.entity';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { AffiliateConversion } from './entities/affiliate-conversion.entity';
import { PostMetric } from './entities/post-metric.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([PostMetric, AffiliateConversion, PublishedPost, ContentPost, AffiliateLink, Product]),
    OrganizationsModule,
    AgentsModule,
    AuditLogsModule,
  ],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}
