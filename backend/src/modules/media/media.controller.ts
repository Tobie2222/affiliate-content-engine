import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import { OrgAccessGuard } from '../organizations/org-access.guard';
import { Permission } from '../organizations/roles';
import { CreateMediaAssetDto, CreateMediaLicenseDto, ListMediaQuery, ReviewLicenseDto } from './dto/media.dto';
import { MediaService } from './media.service';

type Actor = { id: string };

/**
 * Hồ sơ media và giấy phép. Giai đoạn này lưu URL nguồn, chưa lưu file.
 * Luồng: thêm media → khai báo giấy phép (PENDING) → người có quyền duyệt xác nhận → media dùng được.
 */
@ApiTags('media')
@ApiBearerAuth()
@UseGuards(OrgAccessGuard)
@Controller({ path: 'organizations/:orgId/media', version: '1' })
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @RequirePermission(Permission.MediaWrite)
  @Post('assets')
  create(@Param('orgId') orgId: string, @CurrentUser() user: Actor, @Body() dto: CreateMediaAssetDto) {
    return this.media.createAsset(orgId, user.id, dto);
  }

  @RequirePermission(Permission.MediaRead)
  @Get('assets')
  list(@Param('orgId') orgId: string, @Query() query: ListMediaQuery) {
    return this.media.list(orgId, query);
  }

  /** Kiểm tra lại giấy phép tất cả media đang dùng theo thời điểm hiện tại. */
  @RequirePermission(Permission.MediaReview)
  @HttpCode(200)
  @Post('assets/recheck')
  recheck(@Param('orgId') orgId: string, @CurrentUser() user: Actor) {
    return this.media.recheckAll(orgId, user.id);
  }

  @RequirePermission(Permission.MediaRead)
  @Get('assets/:assetId')
  get(@Param('orgId') orgId: string, @Param('assetId', ParseUUIDPipe) assetId: string) {
    return this.media.get(orgId, assetId);
  }

  /** Media có được dùng ngay lúc này không (tính trực tiếp, kèm dòng ghi nguồn bắt buộc). */
  @RequirePermission(Permission.MediaRead)
  @Get('assets/:assetId/usability')
  usability(@Param('orgId') orgId: string, @Param('assetId', ParseUUIDPipe) assetId: string) {
    return this.media.assess(orgId, assetId);
  }

  @RequirePermission(Permission.MediaWrite)
  @Post('assets/:assetId/licenses')
  addLicense(
    @Param('orgId') orgId: string,
    @CurrentUser() user: Actor,
    @Param('assetId', ParseUUIDPipe) assetId: string,
    @Body() dto: CreateMediaLicenseDto,
  ) {
    return this.media.addLicense(orgId, user.id, assetId, dto);
  }

  @RequirePermission(Permission.MediaWrite)
  @HttpCode(200)
  @Post('assets/:assetId/archive')
  archive(
    @Param('orgId') orgId: string,
    @CurrentUser() user: Actor,
    @Param('assetId', ParseUUIDPipe) assetId: string,
  ) {
    return this.media.archive(orgId, user.id, assetId);
  }

  /** Duyệt hoặc từ chối một giấy phép. Chỉ người dùng có quyền media.review; AI không có quyền này. */
  @RequirePermission(Permission.MediaReview)
  @HttpCode(200)
  @Post('licenses/:licenseId/review')
  review(
    @Param('orgId') orgId: string,
    @CurrentUser() user: Actor,
    @Param('licenseId', ParseUUIDPipe) licenseId: string,
    @Body() dto: ReviewLicenseDto,
  ) {
    return this.media.reviewLicense(orgId, user.id, licenseId, dto);
  }
}
