import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { ConnectionsService } from './connections.service';
import { CsvError, CsvParseResult, parseCsv } from './csv';
import { CreateProductDto, ImportProductsDto, ListProductsQuery } from './dto/catalog.dto';
import { Product, ProductDataSource } from './entities/product.entity';
import { ProductInput, CSV_COLUMNS, CSV_REQUIRED_COLUMNS, normalizeProductRow } from './product-normalizer';
import { ProductScore, scoreProduct } from './product-score';
import { SHOPEE_PROVIDER, ShopeeProvider } from './providers/shopee-provider.types';

export const MAX_IMPORT_ROWS = 500;

export interface RowIssue {
  line: number;
  errors: string[];
}

export interface BulkResult {
  totalRows: number;
  valid: number;
  invalid: number;
  created: number;
  updated: number;
  errors: RowIssue[];
}

export interface ImportResult extends BulkResult {
  dryRun: boolean;
  ignoredColumns: string[];
}

export type ProductView = Product & { score: ProductScore };

/**
 * Ghi hoặc cập nhật sản phẩm theo (tổ chức, nhà cung cấp, mã sản phẩm).
 * - Giá trị CHƯA BIẾT (NULL) trong dữ liệu mới KHÔNG xóa giá trị đã biết trước đó.
 * - Thời điểm xác minh giá/hoa hồng chỉ được cập nhật khi dữ liệu mới thực sự có giá/hoa hồng.
 */
const UPSERT_SQL = `
  INSERT INTO products (
    organization_id, provider, external_product_id, name, description, category,
    product_url, image_url, current_price, currency, commission_rate,
    price_verified_at, commission_verified_at, data_source, last_synced_at
  ) VALUES ($1, 'SHOPEE', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
  ON CONFLICT (organization_id, provider, external_product_id) DO UPDATE SET
    name = EXCLUDED.name,
    description = COALESCE(EXCLUDED.description, products.description),
    category = COALESCE(EXCLUDED.category, products.category),
    product_url = EXCLUDED.product_url,
    image_url = COALESCE(EXCLUDED.image_url, products.image_url),
    current_price = COALESCE(EXCLUDED.current_price, products.current_price),
    currency = COALESCE(EXCLUDED.currency, products.currency),
    commission_rate = COALESCE(EXCLUDED.commission_rate, products.commission_rate),
    price_verified_at = CASE WHEN EXCLUDED.current_price IS NOT NULL
                             THEN EXCLUDED.price_verified_at ELSE products.price_verified_at END,
    commission_verified_at = CASE WHEN EXCLUDED.commission_rate IS NOT NULL
                                  THEN EXCLUDED.commission_verified_at ELSE products.commission_verified_at END,
    data_source = EXCLUDED.data_source,
    last_synced_at = EXCLUDED.last_synced_at,
    updated_at = now()
  RETURNING id, (xmax = 0) AS inserted
`;

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

@Injectable()
export class ProductsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Product) private readonly products: Repository<Product>,
    @Inject(SHOPEE_PROVIDER) private readonly provider: ShopeeProvider,
    private readonly connections: ConnectionsService,
    private readonly audit: AuditLogsService,
  ) {}

  toView(product: Product): ProductView {
    return { ...product, score: scoreProduct(product) };
  }

  /** Lấy sản phẩm THUỘC ĐÚNG tổ chức; sản phẩm của tổ chức khác coi như không tồn tại. */
  async requireProduct(organizationId: string, productId: string): Promise<Product> {
    const product = await this.products.findOne({ where: { id: productId, organizationId } });
    if (!product) {
      throw new NotFoundException('Không tìm thấy sản phẩm.');
    }
    return product;
  }

  async get(organizationId: string, productId: string): Promise<ProductView> {
    return this.toView(await this.requireProduct(organizationId, productId));
  }

  async list(
    organizationId: string,
    query: ListProductsQuery,
  ): Promise<{ items: ProductView[]; total: number; limit: number; offset: number }> {
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;
    const qb = this.products
      .createQueryBuilder('p')
      .where('p.organizationId = :organizationId', { organizationId })
      .orderBy('p.createdAt', 'DESC')
      .addOrderBy('p.id', 'ASC')
      .take(limit)
      .skip(offset);
    if (query.search && query.search.trim() !== '') {
      qb.andWhere('p.name ILIKE :q', { q: `%${escapeLike(query.search.trim())}%` });
    }
    const [items, total] = await qb.getManyAndCount();
    return { items: items.map((p) => this.toView(p)), total, limit, offset };
  }

  /** Thêm/cập nhật một sản phẩm nhập tay. Dùng chung bộ kiểm tra với nhập CSV. */
  async createManual(
    organizationId: string,
    actorId: string,
    dto: CreateProductDto,
  ): Promise<ProductView> {
    const result = normalizeProductRow({
      external_product_id: dto.externalProductId,
      name: dto.name,
      product_url: dto.productUrl,
      description: dto.description,
      category: dto.category,
      image_url: dto.imageUrl,
      price: dto.price === undefined ? undefined : String(dto.price),
      currency: dto.currency,
      commission_rate: dto.commissionRate === undefined ? undefined : String(dto.commissionRate),
    });
    if (!result.ok) {
      throw new BadRequestException({ message: 'Dữ liệu sản phẩm không hợp lệ.', errors: result.errors });
    }
    await this.dataSource.transaction((manager) =>
      this.upsert(manager, organizationId, result.value, 'MANUAL', new Date()),
    );
    await this.audit.record({
      organizationId,
      actorId,
      action: 'product.upserted',
      entityType: 'product',
      metadata: { externalProductId: result.value.externalProductId, source: 'MANUAL' },
    });
    const saved = await this.products.findOneOrFail({
      where: { organizationId, provider: 'SHOPEE', externalProductId: result.value.externalProductId },
    });
    return this.toView(saved);
  }

  /** WF-01 (nhập CSV): kiểm tra từng dòng, ghi các dòng hợp lệ, báo rõ dòng lỗi. */
  async importCsv(
    organizationId: string,
    actorId: string,
    dto: ImportProductsDto,
  ): Promise<ImportResult> {
    let parsed: CsvParseResult;
    try {
      parsed = parseCsv(dto.csv);
    } catch (error) {
      if (error instanceof CsvError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }

    const missing = CSV_REQUIRED_COLUMNS.filter((c) => !parsed.headers.includes(c));
    if (missing.length > 0) {
      throw new BadRequestException(`Thiếu cột bắt buộc: ${missing.join(', ')}.`);
    }
    if (parsed.rows.length === 0) {
      throw new BadRequestException('Tệp không có dòng dữ liệu nào.');
    }
    if (parsed.rows.length > MAX_IMPORT_ROWS) {
      throw new BadRequestException(`Tối đa ${MAX_IMPORT_ROWS} dòng mỗi lần nhập.`);
    }

    const known: readonly string[] = CSV_COLUMNS;
    const ignoredColumns = parsed.headers.filter((h) => !known.includes(h));

    const rows = parsed.rows.map((r) => ({ line: r.line, raw: r.values }));
    const bulk = await this.processRows(organizationId, rows, 'CSV', dto.dryRun === true);

    if (!dto.dryRun) {
      await this.audit.record({
        organizationId,
        actorId,
        action: 'product.imported',
        entityType: 'product',
        metadata: { source: 'CSV', created: bulk.created, updated: bulk.updated, invalid: bulk.invalid },
      });
    }
    return { ...bulk, dryRun: dto.dryRun === true, ignoredColumns };
  }

  /** WF-01 (đồng bộ nhà cung cấp): hiện dùng Shopee GIẢ LẬP; chế độ chính thức chưa triển khai. */
  async sync(
    organizationId: string,
    actorId: string,
    connectionId: string,
    limit: number,
  ): Promise<BulkResult & { source: ProductDataSource }> {
    const connection = await this.connections.requireUsable(organizationId, connectionId);
    const fetched = await this.provider.fetchProducts(limit);
    const source: ProductDataSource = this.provider.mode === 'mock' ? 'MOCK' : 'API';
    const rows = fetched.map((raw, index) => ({ line: index + 1, raw }));
    const bulk = await this.processRows(organizationId, rows, source, false);
    await this.connections.markSynced(connection.id);
    await this.audit.record({
      organizationId,
      actorId,
      action: 'product.synced',
      entityType: 'affiliate_connection',
      entityId: connection.id,
      metadata: { source, created: bulk.created, updated: bulk.updated, invalid: bulk.invalid },
    });
    return { ...bulk, source };
  }

  private async processRows(
    organizationId: string,
    rows: Array<{ line: number; raw: Record<string, string | undefined> }>,
    source: ProductDataSource,
    dryRun: boolean,
  ): Promise<BulkResult> {
    const errors: RowIssue[] = [];
    const valid: ProductInput[] = [];
    const seen = new Map<string, number>();

    for (const row of rows) {
      const result = normalizeProductRow(row.raw);
      if (!result.ok) {
        errors.push({ line: row.line, errors: result.errors });
        continue;
      }
      const firstLine = seen.get(result.value.externalProductId);
      if (firstLine !== undefined) {
        errors.push({
          line: row.line,
          errors: [`external_product_id trùng với dòng ${firstLine} trong cùng tệp.`],
        });
        continue;
      }
      seen.set(result.value.externalProductId, row.line);
      valid.push(result.value);
    }

    let created = 0;
    let updated = 0;
    if (!dryRun && valid.length > 0) {
      const now = new Date();
      await this.dataSource.transaction(async (manager) => {
        for (const item of valid) {
          const inserted = await this.upsert(manager, organizationId, item, source, now);
          if (inserted) created++;
          else updated++;
        }
      });
    }

    return {
      totalRows: rows.length,
      valid: valid.length,
      invalid: errors.length,
      created,
      updated,
      errors,
    };
  }

  /** @returns true nếu là bản ghi mới, false nếu cập nhật bản ghi có sẵn. */
  private async upsert(
    manager: EntityManager,
    organizationId: string,
    item: ProductInput,
    source: ProductDataSource,
    now: Date,
  ): Promise<boolean> {
    const rows: Array<{ id: string; inserted: boolean }> = await manager.query(UPSERT_SQL, [
      organizationId,
      item.externalProductId,
      item.name,
      item.description,
      item.category,
      item.productUrl,
      item.imageUrl,
      item.currentPrice,
      item.currency,
      item.commissionRate,
      item.currentPrice === null ? null : now,
      item.commissionRate === null ? null : now,
      source,
      now,
    ]);
    return rows[0].inserted;
  }
}
