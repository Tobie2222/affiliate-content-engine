import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, MoreThanOrEqual, Repository } from 'typeorm';
import { AgentEventType } from '../agents/agent.types';
import { AgentOfficeService } from '../agents/agent-office.service';
import { CsvError, CsvParseResult, parseCsv } from '../affiliate/csv';
import { AffiliateLink } from '../affiliate/entities/affiliate-link.entity';
import { Product } from '../affiliate/entities/product.entity';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { ContentPost } from '../content/entities/content-post.entity';
import { PublishedPost } from '../publishing/entities/published-post.entity';
import {
  CONVERSION_COLUMNS,
  CONVERSION_REQUIRED_COLUMNS,
  MetricValues,
  NormalizedConversion,
  Report,
  buildReport,
  normalizeConversionRow,
  validateMetricInput,
} from './analytics-rules';
import { ImportConversionsDto, RecordMetricsDto, ReportQuery } from './dto/analytics.dto';
import { AffiliateConversion } from './entities/affiliate-conversion.entity';
import { PostMetric } from './entities/post-metric.entity';

const MAX_IMPORT_ROWS = 500;
const DEFAULT_RANGE_DAYS = 30;
const MAX_RANGE_DAYS = 366;
const LOAD_CAP = 5000;
const FUTURE_TOLERANCE_MS = 5 * 60_000;

export interface ConversionRowIssue {
  line: number;
  errors: string[];
}

export interface ConversionImportResult {
  dryRun: boolean;
  totalRows: number;
  valid: number;
  invalid: number;
  created: number;
  updated: number;
  unchanged: number;
  errors: ConversionRowIssue[];
  ignoredColumns: string[];
}

export interface SerializedReport extends Omit<Report, never> {
  from: string;
  to: string;
}

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(PostMetric) private readonly metrics: Repository<PostMetric>,
    @InjectRepository(AffiliateConversion) private readonly conversions: Repository<AffiliateConversion>,
    @InjectRepository(PublishedPost) private readonly published: Repository<PublishedPost>,
    @InjectRepository(ContentPost) private readonly posts: Repository<ContentPost>,
    @InjectRepository(AffiliateLink) private readonly links: Repository<AffiliateLink>,
    @InjectRepository(Product) private readonly products: Repository<Product>,
    private readonly office: AgentOfficeService,
    private readonly audit: AuditLogsService,
  ) {}

  // ---------- Số liệu bài ----------

  /** Người dùng nhập số liệu họ thấy trên Threads. Mỗi lần nhập là một ảnh chụp mới; trường bỏ trống = chưa biết. */
  async recordMetrics(
    organizationId: string,
    actorId: string,
    publishedPostId: string,
    dto: RecordMetricsDto,
    now = new Date(),
  ): Promise<{ metric: PostMetric; warnings: string[] }> {
    const published = await this.published.findOne({ where: { id: publishedPostId, organizationId } });
    if (!published) {
      throw new NotFoundException('Không tìm thấy bài đã đăng.');
    }
    const checked = validateMetricInput(dto);
    if (!checked.ok) {
      throw new BadRequestException(checked.reason);
    }
    const capturedAt = dto.capturedAt ? new Date(dto.capturedAt) : now;
    if (Number.isNaN(capturedAt.getTime())) {
      throw new BadRequestException('Thời điểm ghi nhận không hợp lệ.');
    }
    if (capturedAt.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) {
      throw new BadRequestException('Thời điểm ghi nhận nằm ở tương lai.');
    }
    if (capturedAt.getTime() < published.publishedAt.getTime()) {
      throw new BadRequestException('Thời điểm ghi nhận không thể trước khi bài được đăng.');
    }

    const previous = await this.latestMetric(organizationId, publishedPostId);
    const warnings = metricWarnings(previous, checked.values);

    const metric = await this.metrics.save(
      this.metrics.create({
        organizationId,
        publishedPostId,
        capturedAt,
        ...checked.values,
        source: 'MANUAL',
        recordedBy: actorId,
      }),
    );
    await this.audit.record({
      organizationId,
      actorId,
      action: 'analytics.metrics_recorded',
      entityType: 'published_post',
      entityId: publishedPostId,
      metadata: { source: 'MANUAL' },
    });
    await this.safeEmit(organizationId, 'Đã ghi nhận số liệu bài đăng');
    return { metric, warnings };
  }

  async listMetrics(organizationId: string, publishedPostId: string): Promise<PostMetric[]> {
    const published = await this.published.findOne({ where: { id: publishedPostId, organizationId } });
    if (!published) {
      throw new NotFoundException('Không tìm thấy bài đã đăng.');
    }
    return this.metrics.find({ where: { organizationId, publishedPostId }, order: { capturedAt: 'DESC' }, take: 200 });
  }

  // ---------- Đơn hàng ----------

  /**
   * Nhập báo cáo đơn hàng (CSV). Nhập lại cùng báo cáo chỉ cập nhật trạng thái/hoa hồng, không nhân đôi đơn.
   * Giá trị CHƯA BIẾT trong dữ liệu mới (hoa hồng, sub_id trống) không xóa giá trị đã biết trước đó.
   */
  async importConversions(
    organizationId: string,
    actorId: string,
    dto: ImportConversionsDto,
    now = new Date(),
  ): Promise<ConversionImportResult> {
    let parsed: CsvParseResult;
    try {
      parsed = parseCsv(dto.csv);
    } catch (error) {
      if (error instanceof CsvError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
    const missing = CONVERSION_REQUIRED_COLUMNS.filter((c) => !parsed.headers.includes(c));
    if (missing.length > 0) {
      throw new BadRequestException(`Thiếu cột bắt buộc: ${missing.join(', ')}.`);
    }
    if (parsed.rows.length === 0) {
      throw new BadRequestException('Tệp không có dòng dữ liệu nào.');
    }
    if (parsed.rows.length > MAX_IMPORT_ROWS) {
      throw new BadRequestException(`Tối đa ${MAX_IMPORT_ROWS} dòng mỗi lần nhập.`);
    }
    const known: readonly string[] = CONVERSION_COLUMNS;
    const ignoredColumns = parsed.headers.filter((h) => !known.includes(h));

    const errors: ConversionRowIssue[] = [];
    const valid: Array<{ line: number; value: NormalizedConversion }> = [];
    const seen = new Map<string, number>();
    for (const row of parsed.rows) {
      const result = normalizeConversionRow(row.values, now);
      if (!result.ok) {
        errors.push({ line: row.line, errors: result.errors });
        continue;
      }
      const key = `${result.value.externalOrderId}\u0000${result.value.externalProductId}`;
      const first = seen.get(key);
      if (first !== undefined) {
        errors.push({ line: row.line, errors: [`Trùng với dòng ${first} (cùng order_id và product_id).`] });
        continue;
      }
      seen.set(key, row.line);
      valid.push({ line: row.line, value: result.value });
    }

    const dryRun = dto.dryRun === true;
    let created = 0;
    let updated = 0;
    let unchanged = 0;

    const apply = async (repo: Repository<AffiliateConversion>, write: boolean): Promise<void> => {
      for (const { value } of valid) {
        const existing = await repo.findOne({
          where: { organizationId, externalOrderId: value.externalOrderId, externalProductId: value.externalProductId },
        });
        if (!existing) {
          created += 1;
          if (write) {
            await repo.save(repo.create({ organizationId, ...value, source: 'CSV', importedBy: actorId }));
          }
          continue;
        }
        const merged = mergeConversion(existing, value);
        if (!merged) {
          unchanged += 1;
          continue;
        }
        updated += 1;
        if (write) {
          await repo.update({ id: existing.id, organizationId }, merged);
        }
      }
    };

    if (dryRun) {
      await apply(this.conversions, false);
    } else {
      await this.dataSource.transaction(async (manager) => apply(manager.getRepository(AffiliateConversion), true));
      await this.audit.record({
        organizationId,
        actorId,
        action: 'analytics.conversions_imported',
        entityType: 'affiliate_conversion',
        metadata: { created, updated, unchanged, invalid: errors.length },
      });
      await this.safeEmit(organizationId, `Đã nhập báo cáo đơn hàng: ${created} mới, ${updated} cập nhật`);
    }

    return {
      dryRun,
      totalRows: parsed.rows.length,
      valid: valid.length,
      invalid: errors.length,
      created,
      updated,
      unchanged,
      errors: errors.sort((a, b) => a.line - b.line),
      ignoredColumns,
    };
  }

  async listConversions(organizationId: string, limit = 50, offset = 0) {
    const [items, total] = await this.conversions.findAndCount({
      where: { organizationId },
      order: { orderTime: 'DESC' },
      take: Math.min(Math.max(limit, 1), 200),
      skip: Math.max(offset, 0),
    });
    return { items, total, limit, offset };
  }

  // ---------- Báo cáo ----------

  async report(organizationId: string, query: ReportQuery, now = new Date()): Promise<SerializedReport> {
    const to = query.to ? new Date(query.to) : new Date(now.getTime() + 1);
    const from = query.from ? new Date(query.from) : new Date(to.getTime() - DEFAULT_RANGE_DAYS * 86_400_000);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException('Khoảng thời gian không hợp lệ.');
    }
    if (from.getTime() >= to.getTime()) {
      throw new BadRequestException('Ngày bắt đầu phải trước ngày kết thúc.');
    }
    if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * 86_400_000) {
      throw new BadRequestException(`Khoảng thời gian tối đa ${MAX_RANGE_DAYS} ngày.`);
    }

    const [published, contentPosts, links, products, metrics, conversions] = await Promise.all([
      this.published.find({ where: { organizationId }, order: { publishedAt: 'DESC' }, take: LOAD_CAP }),
      this.posts.find({ where: { organizationId, status: 'PUBLISHED' as ContentPost['status'] }, take: LOAD_CAP }),
      this.links.find({ where: { organizationId } }),
      this.products.find({ where: { organizationId } }),
      this.metrics.find({ where: { organizationId }, order: { capturedAt: 'DESC' }, take: LOAD_CAP }),
      this.conversions.find({ where: { organizationId, orderTime: MoreThanOrEqual(from) }, order: { orderTime: 'DESC' }, take: LOAD_CAP }),
    ]);
    const contentById = new Map(contentPosts.map((p) => [p.id, p]));

    const report = buildReport({
      posts: published.flatMap((p) => {
        const content = contentById.get(p.contentPostId);
        return content
          ? [{
              publishedPostId: p.id,
              contentPostId: p.contentPostId,
              productId: content.productId,
              affiliateLinkId: content.affiliateLinkId,
              socialAccountId: p.socialAccountId,
              publishedAt: p.publishedAt,
            }]
          : [];
      }),
      metrics: metrics.map((m) => ({
        publishedPostId: m.publishedPostId,
        capturedAt: m.capturedAt,
        views: m.views, likes: m.likes, replies: m.replies, reposts: m.reposts, quotes: m.quotes,
        source: m.source,
      })),
      conversions: conversions.map((c) => ({
        externalOrderId: c.externalOrderId,
        externalProductId: c.externalProductId,
        orderTime: c.orderTime,
        status: c.status,
        commissionAmount: c.commissionAmount,
        currency: c.currency,
        subId: c.subId,
      })),
      links: links.map((l) => ({ id: l.id, productId: l.productId, subId: l.subId })),
      products: products.map((p) => ({ id: p.id, externalProductId: p.externalProductId, name: p.name })),
      from,
      to,
    });
    return { ...report, from: from.toISOString(), to: to.toISOString() };
  }

  // ---------- Nội bộ ----------

  private async latestMetric(organizationId: string, publishedPostId: string): Promise<PostMetric | null> {
    const [latest] = await this.metrics.find({ where: { organizationId, publishedPostId }, order: { capturedAt: 'DESC' }, take: 1 });
    return latest ?? null;
  }

  private async safeEmit(organizationId: string, message: string): Promise<void> {
    try {
      await this.office.emit({ organizationId, agentKey: 'analyst', type: AgentEventType.TaskCompleted, message });
    } catch {
      // Phần hiển thị không được làm hỏng nghiệp vụ đã xong.
    }
  }
}

/** Số liệu thấp hơn lần nhập trước thường là nhập nhầm; vẫn lưu nhưng báo để người dùng xem lại. */
export function metricWarnings(previous: PostMetric | null, next: MetricValues): string[] {
  if (!previous) {
    return [];
  }
  const labels: Record<keyof MetricValues, string> = { views: 'Lượt xem', likes: 'Lượt thích', replies: 'Lượt trả lời', reposts: 'Lượt đăng lại', quotes: 'Lượt trích dẫn' };
  const warnings: string[] = [];
  for (const field of Object.keys(labels) as Array<keyof MetricValues>) {
    const before = previous[field];
    const after = next[field];
    if (before !== null && after !== null && after < before) {
      warnings.push(`${labels[field]} (${after}) thấp hơn lần nhập trước (${before}). Hãy kiểm tra lại nếu nhập nhầm.`);
    }
  }
  return warnings;
}

/** Trả về phần cần cập nhật, hoặc null nếu không có gì đổi. Giá trị chưa biết không xóa giá trị đã biết. */
export function mergeConversion(existing: AffiliateConversion, next: NormalizedConversion): Partial<AffiliateConversion> | null {
  const patch: Partial<AffiliateConversion> = {};
  if (existing.status !== next.status) {
    patch.status = next.status;
  }
  if (existing.orderTime.getTime() !== next.orderTime.getTime()) {
    patch.orderTime = next.orderTime;
  }
  if (next.commissionAmount !== null && (existing.commissionAmount !== next.commissionAmount || existing.currency !== next.currency)) {
    patch.commissionAmount = next.commissionAmount;
    patch.currency = next.currency;
  }
  if (next.subId !== null && existing.subId !== next.subId) {
    patch.subId = next.subId;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}
