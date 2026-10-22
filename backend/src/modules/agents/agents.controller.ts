import {
  Body,
  Controller,
  Get,
  MessageEvent,
  Param,
  Post,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Observable, map } from 'rxjs';
import { DevOnlyGuard } from '../../common/guards/dev-only.guard';
import { RequirePermission } from '../auth/decorators';
import { OrgAccessGuard } from '../organizations/org-access.guard';
import { Permission } from '../organizations/roles';
import { AgentOfficeService } from './agent-office.service';
import { EmitDevEventDto, SetAgentStatusDto } from './dto/emit-dev-event.dto';

/**
 * Văn phòng AI của một tổ chức. Cần đăng nhập (guard JWT toàn cục) và là thành viên tổ chức
 * (OrgAccessGuard). Lưu ý: EventSource của trình duyệt không gửi được header Authorization,
 * nên frontend sẽ đọc luồng SSE bằng fetch (Phase 4).
 */
@ApiTags('office')
@ApiBearerAuth()
@UseGuards(OrgAccessGuard)
@Controller({ path: 'organizations/:orgId/office', version: '1' })
export class AgentsController {
  constructor(private readonly office: AgentOfficeService) {}

  @RequirePermission(Permission.OfficeRead)
  @Get('agents')
  listAgents(@Param('orgId') orgId: string) {
    return this.office.listAgents(orgId);
  }

  /** Server-Sent Events: đẩy sự kiện agent theo thời gian thực. */
  @RequirePermission(Permission.OfficeRead)
  @Sse('stream')
  stream(@Param('orgId') orgId: string): Observable<MessageEvent> {
    return this.office.stream(orgId).pipe(map((event) => ({ data: event })));
  }

  /** Tạm dừng / cho agent chạy lại ("dừng tự chạy"). */
  @RequirePermission(Permission.OfficeControl)
  @Post('agents/:key/status')
  setStatus(
    @Param('orgId') orgId: string,
    @Param('key') key: string,
    @Body() dto: SetAgentStatusDto,
  ) {
    return this.office.setStatus(orgId, key, dto.status);
  }

  /** Chỉ ngoài production: phát thử một sự kiện để xem giao diện cập nhật. */
  @UseGuards(DevOnlyGuard)
  @RequirePermission(Permission.OfficeControl)
  @Post('dev/emit')
  emit(@Param('orgId') orgId: string, @Body() dto: EmitDevEventDto) {
    return this.office.emit({ ...dto, organizationId: orgId });
  }
}
