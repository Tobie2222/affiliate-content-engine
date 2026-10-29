import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { AffiliateLink } from '../affiliate/entities/affiliate-link.entity';
import { Product } from '../affiliate/entities/product.entity';
import { AgentOfficeService } from '../agents/agent-office.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { ContentPost } from '../content/entities/content-post.entity';
import { PublishedPost } from '../publishing/entities/published-post.entity';
import { AnalyticsService, mergeConversion } from './analytics.service';
import { AffiliateConversion } from './entities/affiliate-conversion.entity';
import { PostMetric } from './entities/post-metric.entity';

const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ACTOR = '11111111-1111-4111-8111-111111111111';
const PUBLISHED = 'pp-1';
const NOW = new Date('2026-10-29T08:00:00Z');
const PUBLISHED_AT = new Date('2026-10-20T03:00:00Z');

type Row = Record<string, unknown>;
type Op = { type: string; value: Date };
const isOp = (v: unknown): v is Op =>
  typeof v === 'object' && v !== null && !(v instanceof Date) && 'type' in (v as object) && 'value' in (v as object);

function fakeRepo() {
  const rows: Row[] = [];
  let counter = 0;
  const matchOne = (actual: unknown, expected: unknown) => {
    if (isOp(expected)) {
      const a = (actual as Date | null)?.getTime();
      if (a === undefined) {
        return false;
      }
      if (expected.type === 'moreThanOrEqual') {
        return a >= expected.value.getTime();
      }
      throw new Error(`Toán tử chưa được bản giả hỗ trợ: ${expected.type}`);
    }
    return actual === expected;
  };
  const matches = (row: Row, where: Row) => Object.entries(where).every(([k, v]) => matchOne(row[k], v));
  const sorted = (hit: Row[], order?: Record<string, 'ASC' | 'DESC'>) => {
    const [key, dir] = Object.entries(order ?? { createdAt: 'DESC' })[0];
    return hit.sort((a, b) => {
      const d = ((a[key] as Date | undefined)?.getTime() ?? 0) - ((b[key] as Date | undefined)?.getTime() ?? 0);
      return dir === 'ASC' ? d : -d;
    });
  };
  return {
    rows,
    create: (x: Row) => ({ ...x }),
    save: async (x: Row) => {
      counter += 1;
      const saved = { ...x, id: (x.id as string | undefined) ?? `id-${counter}`, createdAt: new Date(NOW.getTime() + counter) };
      rows.push(saved);
      return { ...saved };
    },
    findOne: async ({ where }: { where: Row }) => {
      const found = rows.find((r) => matches(r, where));
      return found ? { ...found } : null;
    },
    find: async ({ where, order, take }: { where: Row; order?: Record<string, 'ASC' | 'DESC'>; take?: number }) => {
      const hit = sorted(rows.filter((r) => matches(r, where)).map((r) => ({ ...r })), order);
      return take ? hit.slice(0, take) : hit;
    },
    findAndCount: async ({ where, order, take, skip }: { where: Row; order?: Record<string, 'ASC' | 'DESC'>; take?: number; skip?: number }) => {
      const all = sorted(rows.filter((r) => matches(r, where)).map((r) => ({ ...r })), order);
      return [all.slice(skip ?? 0, (skip ?? 0) + (take ?? all.length)), all.length] as [Row[], number];
    },
    update: async (criteria: Row, patch: Row) => {
      const hit = rows.filter((r) => matches(r, criteria));
      hit.forEach((r) => Object.assign(r, patch));
      return { affected: hit.length };
    },
  };
}

function setup() {
  const metrics = fakeRepo();
  const conversions = fakeRepo();
  const published = fakeRepo();
  const posts = fakeRepo();
  const links = fakeRepo();
  const products = fakeRepo();
  const byClass = new Map<unknown, unknown>([[AffiliateConversion, conversions]]);
  const dataSource = { transaction: async (work: (m: unknown) => Promise<unknown>) => work({ getRepository: (c: unknown) => byClass.get(c) }) };
  const emitted: string[] = [];
  const office = { emit: async (i: { message: string }) => void emitted.push(i.message) };
  const auditEntries: Array<{ action: string }> = [];
  const audit = { record: async (e: { action: string }) => void auditEntries.push(e) };

  published.rows.push({ id: PUBLISHED, organizationId: ORG_A, contentPostId: 'c1', socialAccountId: 'a1', publishedAt: PUBLISHED_AT, createdAt: PUBLISHED_AT });
  posts.rows.push({ id: 'c1', organizationId: ORG_A, productId: 'prod1', affiliateLinkId: 'L1', status: 'PUBLISHED', createdAt: PUBLISHED_AT });
  links.rows.push({ id: 'L1', organizationId: ORG_A, productId: 'prod1', subId: 'post-1', createdAt: PUBLISHED_AT });
  products.rows.push({ id: 'prod1', organizationId: ORG_A, externalProductId: 'SP001', name: 'Bình giữ nhiệt', createdAt: PUBLISHED_AT });

  const service = new AnalyticsService(
    dataSource as unknown as DataSource,
    metrics as unknown as Repository<PostMetric>,
    conversions as unknown as Repository<AffiliateConversion>,
    published as unknown as Repository<PublishedPost>,
    posts as unknown as Repository<ContentPost>,
    links as unknown as Repository<AffiliateLink>,
    products as unknown as Repository<Product>,
    office as unknown as AgentOfficeService,
    audit as unknown as AuditLogsService,
  );
  return { service, metrics, conversions, emitted, auditEntries };
}

const HEADER = 'order_id,product_id,order_time,status,commission,currency,sub_id';
const csv = (...lines: string[]) => [HEADER, ...lines].join('\n');

describe('AnalyticsService.recordMetrics', () => {
  const at = new Date('2026-10-25T00:00:00Z');

  it('lưu ảnh chụp số liệu nhập tay; trường bỏ trống là null', async () => {
    const ctx = setup();
    const { metric, warnings } = await ctx.service.recordMetrics(ORG_A, ACTOR, PUBLISHED, { views: 120, likes: 7, capturedAt: at.toISOString() }, NOW);
    expect(metric).toMatchObject({ views: 120, likes: 7, replies: null, reposts: null, quotes: null, source: 'MANUAL', recordedBy: ACTOR });
    expect(warnings).toEqual([]);
    expect(ctx.auditEntries.map((e) => e.action)).toContain('analytics.metrics_recorded');
  });

  it('mặc định thời điểm ghi nhận là bây giờ', async () => {
    const ctx = setup();
    const { metric } = await ctx.service.recordMetrics(ORG_A, ACTOR, PUBLISHED, { views: 1 }, NOW);
    expect(metric.capturedAt).toEqual(NOW);
  });

  it('không nhập số liệu cho bài của tổ chức khác', async () => {
    const ctx = setup();
    await expect(ctx.service.recordMetrics(ORG_B, ACTOR, PUBLISHED, { views: 1 }, NOW)).rejects.toBeInstanceOf(NotFoundException);
    expect(ctx.metrics.rows.length).toBe(0);
  });

  it('từ chối rỗng, tương lai, trước giờ đăng', async () => {
    const ctx = setup();
    await expect(ctx.service.recordMetrics(ORG_A, ACTOR, PUBLISHED, {}, NOW)).rejects.toBeInstanceOf(BadRequestException);
    await expect(ctx.service.recordMetrics(ORG_A, ACTOR, PUBLISHED, { views: 1, capturedAt: '2026-11-30T00:00:00Z' }, NOW)).rejects.toThrow('tương lai');
    await expect(ctx.service.recordMetrics(ORG_A, ACTOR, PUBLISHED, { views: 1, capturedAt: '2026-10-19T00:00:00Z' }, NOW)).rejects.toThrow('trước khi bài được đăng');
    expect(ctx.metrics.rows.length).toBe(0);
  });

  it('cảnh báo (vẫn lưu) khi số thấp hơn lần nhập trước', async () => {
    const ctx = setup();
    await ctx.service.recordMetrics(ORG_A, ACTOR, PUBLISHED, { views: 500, capturedAt: '2026-10-24T00:00:00Z' }, NOW);
    const { warnings } = await ctx.service.recordMetrics(ORG_A, ACTOR, PUBLISHED, { views: 300, likes: 2, capturedAt: at.toISOString() }, NOW);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Lượt xem (300) thấp hơn');
    expect(ctx.metrics.rows.length).toBe(2);
  });
});

describe('AnalyticsService.importConversions', () => {
  it('nhập đơn mới, báo số lượng, ghi nhật ký', async () => {
    const ctx = setup();
    const result = await ctx.service.importConversions(ORG_A, ACTOR, {
      csv: csv('O1,SP001,2026-10-22,completed,15000,VND,post-1', 'O2,SP001,2026-10-23 10:00,pending,,,'),
    }, NOW);
    expect(result).toMatchObject({ dryRun: false, totalRows: 2, valid: 2, invalid: 0, created: 2, updated: 0, unchanged: 0 });
    expect(ctx.conversions.rows).toHaveLength(2);
    expect(ctx.conversions.rows[0]).toMatchObject({ organizationId: ORG_A, status: 'COMPLETED', commissionAmount: 15000, currency: 'VND', subId: 'post-1', source: 'CSV', importedBy: ACTOR });
    expect(ctx.conversions.rows[1]).toMatchObject({ status: 'PENDING', commissionAmount: null, subId: null });
    expect(ctx.auditEntries.map((e) => e.action)).toContain('analytics.conversions_imported');
  });

  it('nhập lại cùng báo cáo không nhân đôi đơn', async () => {
    const ctx = setup();
    const body = { csv: csv('O1,SP001,2026-10-22,completed,15000,VND,post-1') };
    await ctx.service.importConversions(ORG_A, ACTOR, body, NOW);
    const again = await ctx.service.importConversions(ORG_A, ACTOR, body, NOW);
    expect(again).toMatchObject({ created: 0, updated: 0, unchanged: 1 });
    expect(ctx.conversions.rows).toHaveLength(1);
  });

  it('cập nhật trạng thái và hoa hồng khi báo cáo mới hơn (pending -> completed)', async () => {
    const ctx = setup();
    await ctx.service.importConversions(ORG_A, ACTOR, { csv: csv('O1,SP001,2026-10-22,pending,,,post-1') }, NOW);
    const result = await ctx.service.importConversions(ORG_A, ACTOR, { csv: csv('O1,SP001,2026-10-22,completed,15000,VND,post-1') }, NOW);
    expect(result).toMatchObject({ created: 0, updated: 1 });
    expect(ctx.conversions.rows[0]).toMatchObject({ status: 'COMPLETED', commissionAmount: 15000, currency: 'VND' });
  });

  it('giá trị chưa biết trong báo cáo mới không xóa giá trị đã biết', async () => {
    const ctx = setup();
    await ctx.service.importConversions(ORG_A, ACTOR, { csv: csv('O1,SP001,2026-10-22,completed,15000,VND,post-1') }, NOW);
    const result = await ctx.service.importConversions(ORG_A, ACTOR, { csv: csv('O1,SP001,2026-10-22,completed,,,') }, NOW);
    expect(result.unchanged).toBe(1);
    expect(ctx.conversions.rows[0]).toMatchObject({ commissionAmount: 15000, currency: 'VND', subId: 'post-1' });
  });

  it('dryRun: báo kết quả nhưng không ghi gì', async () => {
    const ctx = setup();
    const result = await ctx.service.importConversions(ORG_A, ACTOR, { csv: csv('O1,SP001,2026-10-22,completed,15000,VND,post-1'), dryRun: true }, NOW);
    expect(result).toMatchObject({ dryRun: true, created: 1, valid: 1 });
    expect(ctx.conversions.rows).toHaveLength(0);
    expect(ctx.auditEntries).toHaveLength(0);
  });

  it('dòng lỗi được báo kèm số dòng; dòng hợp lệ vẫn được ghi; dòng trùng trong tệp bị loại', async () => {
    const ctx = setup();
    const result = await ctx.service.importConversions(ORG_A, ACTOR, {
      csv: csv('O1,SP001,2026-10-22,completed,15000,VND,post-1', 'O2,SP001,27/10/2026,completed,,,', 'O1,SP001,2026-10-22,completed,15000,VND,post-1', 'O3,SP001,2026-10-22,completed,15.000,VND,'),
    }, NOW);
    expect(result).toMatchObject({ totalRows: 4, valid: 1, invalid: 3, created: 1 });
    expect(result.errors.map((e) => e.line)).toEqual([3, 4, 5]);
    expect(result.errors[1].errors[0]).toContain('Trùng với dòng 2');
    expect(ctx.conversions.rows).toHaveLength(1);
  });

  it('báo cột lạ bị bỏ qua; từ chối thiếu cột, tệp rỗng, quá nhiều dòng', async () => {
    const ctx = setup();
    const withExtra = await ctx.service.importConversions(ORG_A, ACTOR, { csv: 'order_id,product_id,order_time,status,ghi_chu\nO1,SP001,2026-10-22,completed,abc' }, NOW);
    expect(withExtra.ignoredColumns).toEqual(['ghi_chu']);
    await expect(ctx.service.importConversions(ORG_A, ACTOR, { csv: 'order_id,product_id\nO1,SP001' }, NOW)).rejects.toThrow('Thiếu cột bắt buộc');
    await expect(ctx.service.importConversions(ORG_A, ACTOR, { csv: HEADER }, NOW)).rejects.toThrow('không có dòng dữ liệu');
    const many = Array.from({ length: 501 }, (_, i) => `O${i},SP001,2026-10-22,completed,,,`);
    await expect(ctx.service.importConversions(ORG_A, ACTOR, { csv: csv(...many) }, NOW)).rejects.toThrow('Tối đa 500');
  });

  it('đơn của tổ chức khác không bị đụng tới', async () => {
    const ctx = setup();
    await ctx.service.importConversions(ORG_B, ACTOR, { csv: csv('O1,SP001,2026-10-22,pending,,,') }, NOW);
    const result = await ctx.service.importConversions(ORG_A, ACTOR, { csv: csv('O1,SP001,2026-10-22,completed,,,') }, NOW);
    expect(result.created).toBe(1);
    expect(ctx.conversions.rows).toHaveLength(2);
  });
});

describe('mergeConversion', () => {
  const existing = { status: 'PENDING', orderTime: new Date('2026-10-22T00:00:00Z'), commissionAmount: null, currency: null, subId: null } as AffiliateConversion;
  const next = { externalOrderId: 'O', externalProductId: 'P', orderTime: existing.orderTime, status: 'PENDING' as const, commissionAmount: null, currency: null, subId: null };

  it('không có gì đổi -> null', () => {
    expect(mergeConversion(existing, next)).toBeNull();
  });

  it('cập nhật đúng phần thay đổi', () => {
    expect(mergeConversion(existing, { ...next, status: 'COMPLETED', commissionAmount: 100, currency: 'VND' })).toEqual({ status: 'COMPLETED', commissionAmount: 100, currency: 'VND' });
  });
});

describe('AnalyticsService.report', () => {
  it('end-to-end: đơn có sub_id khớp được gắn vào bài, đơn không sub_id nằm ở nhóm chưa gắn được', async () => {
    const ctx = setup();
    await ctx.service.recordMetrics(ORG_A, ACTOR, PUBLISHED, { views: 900, likes: 40 }, NOW);
    await ctx.service.importConversions(ORG_A, ACTOR, {
      csv: csv('O1,SP001,2026-10-22,completed,15000,VND,post-1', 'O2,SP001,2026-10-23,cancelled,,,post-1', 'O3,SP001,2026-10-24,completed,8000,VND,'),
    }, NOW);
    const report = await ctx.service.report(ORG_A, {}, NOW);
    expect(report.posts).toHaveLength(1);
    expect(report.posts[0].metrics).toMatchObject({ views: 900, likes: 40, replies: null });
    expect(report.posts[0].orders).toMatchObject({ completed: 1, cancelled: 1, commission: { VND: { confirmed: 15000, pending: 0 } } });
    expect(report.unattributed).toHaveLength(1);
    expect(report.unattributed[0]).toMatchObject({ productName: 'Bình giữ nhiệt', reasons: { NO_SUBID: 1 } });
    expect(report.totals.views).toEqual({ total: 900, knownPosts: 1 });
  });

  it('không lộ dữ liệu của tổ chức khác', async () => {
    const ctx = setup();
    await ctx.service.importConversions(ORG_A, ACTOR, { csv: csv('O1,SP001,2026-10-22,completed,15000,VND,post-1') }, NOW);
    const other = await ctx.service.report(ORG_B, {}, NOW);
    expect(other.posts).toEqual([]);
    expect(other.unattributed).toEqual([]);
  });

  it('kiểm tra khoảng thời gian', async () => {
    const ctx = setup();
    await expect(ctx.service.report(ORG_A, { from: '2026-10-10', to: '2026-10-01' }, NOW)).rejects.toBeInstanceOf(BadRequestException);
    await expect(ctx.service.report(ORG_A, { from: '2024-01-01', to: '2026-10-01' }, NOW)).rejects.toThrow('tối đa');
    await expect(ctx.service.report(ORG_A, { from: 'abc' }, NOW)).rejects.toBeInstanceOf(BadRequestException);
  });
});
