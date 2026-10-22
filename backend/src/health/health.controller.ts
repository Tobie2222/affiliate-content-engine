import {
  Controller,
  Get,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../modules/auth/decorators';
import { HealthService, ReadinessReport } from './health.service';

@Public()
@ApiTags('health')
@Controller({ path: 'health', version: '1' })
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** Liveness: tiến trình còn chạy. Không kiểm tra phụ thuộc ngoài. */
  @Get()
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Readiness: PostgreSQL và Redis phải sẵn sàng. */
  @Get('ready')
  async ready(): Promise<ReadinessReport> {
    const report = await this.health.readiness();
    if (report.status !== 'ok') {
      throw new ServiceUnavailableException(report);
    }
    return report;
  }
}
