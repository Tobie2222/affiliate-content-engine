import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import { OrgAccessGuard } from '../organizations/org-access.guard';
import { Permission } from '../organizations/roles';
import { ContentService } from './content.service';
import {
  CreatePostDto,
  GeneratePostsDto,
  ListPostsQuery,
  ReviewPostDto,
  UpdatePostDto,
} from './dto/content.dto';

type Actor = { id: string };

/**
 * Bài viết affiliate. Luồng: soạn tay hoặc để AI đề xuất (DRAFT) → QA tự động → gửi duyệt →
 * NGƯỜI có quyền content.review duyệt / yêu cầu sửa / từ chối. AI không có đường nào để duyệt hay đăng.
 */
@ApiTags('content')
@ApiBearerAuth()
@UseGuards(OrgAccessGuard)
@Controller({ path: 'organizations/:orgId/content/posts', version: '1' })
export class ContentController {
  constructor(private readonly content: ContentService) {}

  @RequirePermission(Permission.ContentRead)
  @Get()
  list(@Param('orgId') orgId: string, @Query() query: ListPostsQuery) {
    return this.content.list(orgId, query);
  }

  @RequirePermission(Permission.ContentRead)
  @Get(':postId')
  get(@Param('orgId') orgId: string, @Param('postId', new ParseUUIDPipe()) postId: string) {
    return this.content.get(orgId, postId);
  }

  @RequirePermission(Permission.ContentWrite)
  @Post()
  create(@Param('orgId') orgId: string, @CurrentUser() user: Actor, @Body() dto: CreatePostDto) {
    return this.content.create(orgId, user.id, dto);
  }

  /** AI đề xuất bản nháp. Bản nháp luôn ở DRAFT và phải qua QA + người duyệt. */
  @RequirePermission(Permission.ContentWrite)
  @HttpCode(201)
  @Post('generate')
  generate(@Param('orgId') orgId: string, @CurrentUser() user: Actor, @Body() dto: GeneratePostsDto) {
    return this.content.generate(orgId, user.id, dto);
  }

  @RequirePermission(Permission.ContentWrite)
  @Patch(':postId')
  update(
    @Param('orgId') orgId: string,
    @Param('postId', new ParseUUIDPipe()) postId: string,
    @CurrentUser() user: Actor,
    @Body() dto: UpdatePostDto,
  ) {
    return this.content.update(orgId, user.id, postId, dto);
  }

  /** Chạy lại QA (kiểm tra nội dung, link affiliate, giấy phép media) và lưu kết quả. */
  @RequirePermission(Permission.ContentRead)
  @HttpCode(200)
  @Post(':postId/qa')
  qa(@Param('orgId') orgId: string, @Param('postId', new ParseUUIDPipe()) postId: string) {
    return this.content.runQa(orgId, postId);
  }

  @RequirePermission(Permission.ContentWrite)
  @HttpCode(200)
  @Post(':postId/submit')
  submit(
    @Param('orgId') orgId: string,
    @Param('postId', new ParseUUIDPipe()) postId: string,
    @CurrentUser() user: Actor,
  ) {
    return this.content.submit(orgId, user.id, postId);
  }

  @RequirePermission(Permission.ContentWrite)
  @HttpCode(200)
  @Post(':postId/withdraw')
  withdraw(
    @Param('orgId') orgId: string,
    @Param('postId', new ParseUUIDPipe()) postId: string,
    @CurrentUser() user: Actor,
  ) {
    return this.content.withdraw(orgId, user.id, postId);
  }

  @RequirePermission(Permission.ContentReview)
  @HttpCode(200)
  @Post(':postId/review')
  review(
    @Param('orgId') orgId: string,
    @Param('postId', new ParseUUIDPipe()) postId: string,
    @CurrentUser() user: Actor,
    @Body() dto: ReviewPostDto,
  ) {
    return this.content.review(orgId, user.id, postId, dto);
  }
}
