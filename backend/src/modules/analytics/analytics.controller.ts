import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import { OrgAccessGuard } from '../organizations/org-access.guard';
import { Permission } from '../organizations/roles';
import { AnalyticsService } from './analytics.service';
import { ImportConversionsDto, RecordMetricsDto, ReportQuery } from './dto/analytics.dto';

type Actor = { id: string };

/**
 * Số liệu bài đăng (nhập tay) và đơn hàng affiliate (nhập CSV). Đơn chỉ được gắn vào bài khi đủ căn cứ (sub_id),
 * còn lại hiển thị là "chưa gắn được" kèm lý do. Số liệu chưa biết hiển thị là chưa biết, không phải 0.
 */
@ApiTags('analytics')
@ApiBearerAuth()
@UseGuards(OrgAccessGuard)
@Controller({ path: 'organizations/:orgId/analytics', version: '1' })
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @RequirePermission(Permission.AnalyticsRead)
  @Get('report')
  report(@Param('orgId') orgId: string, @Query() query: ReportQuery) {
    return this.analytics.report(orgId, query);
  }

  @RequirePermission(Permission.AnalyticsRead)
  @Get('published/:publishedPostId/metrics')
  listMetrics(@Param('orgId') orgId: string, @Param('publishedPostId', new ParseUUIDPipe()) id: string) {
    return this.analytics.listMetrics(orgId, id);
  }

  @RequirePermission(Permission.AnalyticsWrite)
  @HttpCode(201)
  @Post('published/:publishedPostId/metrics')
  recordMetrics(
    @Param('orgId') orgId: string,
    @CurrentUser() user: Actor,
    @Param('publishedPostId', new ParseUUIDPipe()) id: string,
    @Body() dto: RecordMetricsDto,
  ) {
    return this.analytics.recordMetrics(orgId, user.id, id, dto);
  }

  @RequirePermission(Permission.AnalyticsRead)
  @Get('conversions')
  listConversions(@Param('orgId') orgId: string) {
    return this.analytics.listConversions(orgId);
  }

  @RequirePermission(Permission.AnalyticsWrite)
  @HttpCode(200)
  @Post('conversions/import')
  importConversions(@Param('orgId') orgId: string, @CurrentUser() user: Actor, @Body() dto: ImportConversionsDto) {
    return this.analytics.importConversions(orgId, user.id, dto);
  }
}
