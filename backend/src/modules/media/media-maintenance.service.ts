import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Organization } from '../organizations/entities/organization.entity';
import { MediaService } from './media.service';

const MAX_ORGANIZATIONS_PER_RUN = 1000;

export interface MaintenanceSummary {
  organizations: number;
  failed: number;
  checked: number;
  changed: number;
}

/**
 * Quét định kỳ giấy phép media của MỌI tổ chức để trạng thái lưu (hết hạn, sắp hết hạn) luôn mới.
 * Đây chỉ là bản lưu tạm cho danh sách; QA và việc đăng bài vẫn tự tính lại trực tiếp nên không phụ thuộc lần quét này.
 * Một tổ chức lỗi không làm dừng các tổ chức còn lại.
 */
@Injectable()
export class MediaMaintenanceService {
  private readonly logger = new Logger(MediaMaintenanceService.name);

  constructor(
    @InjectRepository(Organization) private readonly orgs: Repository<Organization>,
    private readonly media: MediaService,
  ) {}

  async recheckAllOrganizations(now = new Date()): Promise<MaintenanceSummary> {
    const organizations = await this.orgs.find({ order: { createdAt: 'ASC' }, take: MAX_ORGANIZATIONS_PER_RUN });
    const summary: MaintenanceSummary = { organizations: organizations.length, failed: 0, checked: 0, changed: 0 };
    for (const org of organizations) {
      try {
        const result = await this.media.recheckAll(org.id, null, now);
        summary.checked += result.checked;
        summary.changed += result.changed;
      } catch (error) {
        summary.failed += 1;
        // Chỉ ghi id tổ chức và loại lỗi, không ghi nội dung lỗi (có thể chứa dữ liệu).
        this.logger.warn(`Quét giấy phép thất bại cho tổ chức ${org.id}: ${error instanceof Error ? error.name : 'lỗi không rõ'}`);
      }
    }
    return summary;
  }
}
