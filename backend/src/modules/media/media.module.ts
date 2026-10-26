import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { MediaAsset } from './entities/media-asset.entity';
import { MediaLicense } from './entities/media-license.entity';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([MediaAsset, MediaLicense]),
    OrganizationsModule, // cung cấp OrgAccessGuard
    AuditLogsModule,
  ],
  controllers: [MediaController],
  providers: [MediaService],
  exports: [MediaService],
})
export class MediaModule {}
