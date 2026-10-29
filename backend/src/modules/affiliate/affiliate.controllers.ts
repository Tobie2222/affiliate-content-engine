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
import { AffiliateLinksService } from './affiliate-links.service';
import { ConnectionsService } from './connections.service';
import {
  CreateConnectionDto,
  CreateLinkDto,
  CreateProductDto,
  GenerateLinkDto,
  ImportProductsDto,
  ListProductsQuery,
  SyncProductsDto,
} from './dto/catalog.dto';
import { ProductsService } from './products.service';

type Actor = { id: string };

@ApiTags('affiliate')
@ApiBearerAuth()
@UseGuards(OrgAccessGuard)
@Controller({ path: 'organizations/:orgId/affiliate-connections', version: '1' })
export class AffiliateConnectionsController {
  constructor(private readonly connections: ConnectionsService) {}

  /** Hiện chỉ tạo được kết nối GIẢ LẬP (MOCK). */
  @RequirePermission(Permission.CatalogWrite)
  @Post()
  create(
    @Param('orgId') orgId: string,
    @CurrentUser() user: Actor,
    @Body() _dto: CreateConnectionDto,
  ) {
    return this.connections.create(orgId, user.id);
  }

  @RequirePermission(Permission.CatalogRead)
  @Get()
  list(@Param('orgId') orgId: string) {
    return this.connections.list(orgId);
  }
}

@ApiTags('products')
@ApiBearerAuth()
@UseGuards(OrgAccessGuard)
@Controller({ path: 'organizations/:orgId/products', version: '1' })
export class ProductsController {
  constructor(
    private readonly products: ProductsService,
    private readonly links: AffiliateLinksService,
  ) {}

  @RequirePermission(Permission.CatalogRead)
  @Get()
  list(@Param('orgId') orgId: string, @Query() query: ListProductsQuery) {
    return this.products.list(orgId, query);
  }

  /** Thêm hoặc cập nhật một sản phẩm nhập tay (theo external_product_id). */
  @RequirePermission(Permission.CatalogWrite)
  @Post()
  create(@Param('orgId') orgId: string, @CurrentUser() user: Actor, @Body() dto: CreateProductDto) {
    return this.products.createManual(orgId, user.id, dto);
  }

  @RequirePermission(Permission.CatalogWrite)
  @HttpCode(200)
  @Post('import')
  importCsv(@Param('orgId') orgId: string, @CurrentUser() user: Actor, @Body() dto: ImportProductsDto) {
    return this.products.importCsv(orgId, user.id, dto);
  }

  /** Đồng bộ từ nhà cung cấp. Hiện là Shopee GIẢ LẬP. */
  @RequirePermission(Permission.CatalogWrite)
  @HttpCode(200)
  @Post('sync')
  sync(@Param('orgId') orgId: string, @CurrentUser() user: Actor, @Body() dto: SyncProductsDto) {
    return this.products.sync(orgId, user.id, dto.connectionId, dto.limit ?? 50);
  }

  @RequirePermission(Permission.CatalogRead)
  @Get(':productId')
  get(@Param('orgId') orgId: string, @Param('productId', new ParseUUIDPipe()) productId: string) {
    return this.products.get(orgId, productId);
  }

  @RequirePermission(Permission.CatalogRead)
  @Get(':productId/links')
  listLinks(
    @Param('orgId') orgId: string,
    @Param('productId', new ParseUUIDPipe()) productId: string,
  ) {
    return this.links.list(orgId, productId);
  }

  /** Đăng ký link affiliate do bạn tự có. Ở trạng thái UNVERIFIED cho tới khi được xác minh. */
  @RequirePermission(Permission.CatalogWrite)
  @Post(':productId/links')
  createLink(
    @Param('orgId') orgId: string,
    @Param('productId', new ParseUUIDPipe()) productId: string,
    @CurrentUser() user: Actor,
    @Body() dto: CreateLinkDto,
  ) {
    return this.links.createUserSupplied(orgId, user.id, productId, dto.affiliateUrl, dto.subId);
  }

  /** Tạo link qua nhà cung cấp. Hiện là Shopee GIẢ LẬP (link nguồn MOCK). */
  @RequirePermission(Permission.CatalogWrite)
  @Post(':productId/links/generate')
  generateLink(
    @Param('orgId') orgId: string,
    @Param('productId', new ParseUUIDPipe()) productId: string,
    @CurrentUser() user: Actor,
    @Body() dto: GenerateLinkDto,
  ) {
    return this.links.generate(orgId, user.id, productId, dto.connectionId, dto.subId);
  }
}

@ApiTags('affiliate')
@ApiBearerAuth()
@UseGuards(OrgAccessGuard)
@Controller({ path: 'organizations/:orgId/affiliate-links', version: '1' })
export class AffiliateLinksController {
  constructor(private readonly links: AffiliateLinksService) {}

  /** Người có quyền xác nhận đã kiểm tra link thật. */
  @RequirePermission(Permission.LinksVerify)
  @HttpCode(200)
  @Post(':linkId/verify')
  verify(
    @Param('orgId') orgId: string,
    @Param('linkId', new ParseUUIDPipe()) linkId: string,
    @CurrentUser() user: Actor,
  ) {
    return this.links.verify(orgId, user.id, linkId);
  }

  @RequirePermission(Permission.CatalogWrite)
  @HttpCode(200)
  @Post(':linkId/revoke')
  revoke(
    @Param('orgId') orgId: string,
    @Param('linkId', new ParseUUIDPipe()) linkId: string,
    @CurrentUser() user: Actor,
  ) {
    return this.links.revoke(orgId, user.id, linkId);
  }
}
