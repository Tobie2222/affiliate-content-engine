import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { DevOnlyGuard } from '../../common/guards/dev-only.guard';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import { OrgAccessGuard } from '../organizations/org-access.guard';
import { Permission } from '../organizations/roles';
import { CreateSocialAccountDto, RetryPublishDto, SchedulePostDto } from './dto/publishing.dto';
import { PublishingService } from './publishing.service';

type Actor = { id: string };

/** Tài khoản Threads. Hiện chỉ có tài khoản MOCK (chạy thử, không đăng thật). */
@ApiTags('social-accounts')
@ApiBearerAuth()
@UseGuards(OrgAccessGuard)
@Controller({ path: 'organizations/:orgId/social-accounts', version: '1' })
export class SocialAccountsController {
  constructor(private readonly publishing: PublishingService) {}

  @RequirePermission(Permission.SocialRead)
  @Get()
  list(@Param('orgId') orgId: string) {
    return this.publishing.listAccounts(orgId);
  }

  @RequirePermission(Permission.SocialManage)
  @HttpCode(201)
  @Post()
  create(@Param('orgId') orgId: string, @CurrentUser() user: Actor, @Body() dto: CreateSocialAccountDto) {
    return this.publishing.createAccount(orgId, user.id, dto);
  }

  @RequirePermission(Permission.SocialManage)
  @HttpCode(200)
  @Post(':accountId/disconnect')
  disconnect(
    @Param('orgId') orgId: string,
    @CurrentUser() user: Actor,
    @Param('accountId', new ParseUUIDPipe()) accountId: string,
  ) {
    return this.publishing.disconnectAccount(orgId, user.id, accountId);
  }
}

/**
 * Lên lịch và đăng bài ĐÃ ĐƯỢC NGƯỜI DUYỆT. Không có đường nào đăng bài chưa duyệt:
 * state machine chỉ cho APPROVED -> SCHEDULED và kiểm tra lại tài khoản, link, giấy phép trước mỗi bước.
 */
@ApiTags('publishing')
@ApiBearerAuth()
@UseGuards(OrgAccessGuard)
@Controller({ path: 'organizations/:orgId', version: '1' })
export class PublishingController {
  constructor(private readonly publishing: PublishingService) {}

  @RequirePermission(Permission.ContentRead)
  @Get('content/posts/:postId/publishing')
  get(@Param('orgId') orgId: string, @Param('postId', new ParseUUIDPipe()) postId: string) {
    return this.publishing.getForPost(orgId, postId);
  }

  @RequirePermission(Permission.PublishManage)
  @HttpCode(201)
  @Post('content/posts/:postId/schedule')
  schedule(
    @Param('orgId') orgId: string,
    @CurrentUser() user: Actor,
    @Param('postId', new ParseUUIDPipe()) postId: string,
    @Body() dto: SchedulePostDto,
  ) {
    return this.publishing.schedule(orgId, user.id, postId, dto);
  }

  @RequirePermission(Permission.PublishManage)
  @HttpCode(200)
  @Post('content/posts/:postId/unschedule')
  unschedule(
    @Param('orgId') orgId: string,
    @CurrentUser() user: Actor,
    @Param('postId', new ParseUUIDPipe()) postId: string,
  ) {
    return this.publishing.unschedule(orgId, user.id, postId);
  }

  @RequirePermission(Permission.PublishManage)
  @HttpCode(200)
  @Post('content/posts/:postId/retry-publish')
  retry(
    @Param('orgId') orgId: string,
    @CurrentUser() user: Actor,
    @Param('postId', new ParseUUIDPipe()) postId: string,
    @Body() dto: RetryPublishDto,
  ) {
    return this.publishing.retry(orgId, user.id, postId, dto);
  }

  /** Chạy ngay các việc đã đến giờ của tổ chức này (chỉ môi trường dev; production dùng worker định kỳ). */
  @UseGuards(DevOnlyGuard)
  @RequirePermission(Permission.PublishManage)
  @HttpCode(200)
  @Post('publishing/run-due')
  runDue(@Param('orgId') orgId: string) {
    return this.publishing.runDue(new Date(), orgId);
  }
}
