import { BullModule } from '@nestjs/bullmq';
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { Organization } from '../organizations/entities/organization.entity';
import { Organization } from '../organizations/entities/organization.entity';
import { OrganizationsModule } from '../organizations/organizations.module';
import { MediaAsset } from './entities/media-asset.entity';
import { MediaLicense } from './entities/media-license.entity';
import { MediaController } from './media.controller';
import { MEDIA_MAINTENANCE_QUEUE, MediaMaintenanceProcessor, MediaMaintenanceScheduler } from './media-maintenance.worker';
import { MediaMaintenanceService } from './media-maintenance.service';
import { MediaMaintenanceService } from './media-maintenance.service';
import { MEDIA_MAINTENANCE_QUEUE, MediaMaintenanceProcessor, MediaMaintenanceScheduler } from './media-maintenance.worker';
import { MediaService } from './media.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([MediaAsset, MediaLicense, Organization]),
    BullModule.registerQueue({ name: MEDIA_MAINTENANCE_QUEUE }),
    OrganizationsModule, // cung cấp OrgAccessGuard
    AuditLogsModule,
  ],
  controllers: [MediaController],
  providers: [MediaService, MediaMaintenanceService, MediaMaintenanceProcessor, MediaMaintenanceScheduler],
  exports: [MediaService],
})
export class MediaModule {}
