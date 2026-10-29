import type { ConversionStatus } from './entities/affiliate-conversion.entity';

const VN_OFFSET_MS = 7 * 60 * 60_000;
/** Tối đa 2 chữ số thập phân: "15.000" (người Việt hay dùng làm dấu phân cách nghìn) bị từ chối thay vì hiểu thành 15. */
const DECIMAL = /^\d+(\.\d{1,2})?$/;
const MAX_COMMISSION = 1_000_000_000;
const MAX_METRIC = 1_000_000_000;
const MAX_FUTURE_MS = 24 * 60 * 60_000;

export const CONVERSION_COLUMNS = ['order_id', 'product_id', 'order_time', 'status', 'commission', 'currency', 'sub_id'] as const;
export const CONVERSION_REQUIRED_COLUMNS = ['order_id', 'product_id', 'order_time', 'status'] as const;

const STATUS_MAP: Record<string, ConversionStatus> = {
  pending: 'PENDING',
  completed: 'COMPLETED',
  cancelled: 'CANCELLED',
  canceled: 'CANCELLED',
};

export interface NormalizedConversion {
  externalOrderId: string;
  externalProductId: string;
  orderTime: Date;
  status: ConversionStatus;
  commissionAmount: number | null;
  currency: string | null;
  subId: string | null;
}

export type ConversionRowResult = { ok: true; value: NormalizedConversion } | { ok: false; errors: string[] };

function clean(value: string | undefined | null): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Thời gian đơn hàng: "2026-10-27" (0:00 giờ Việt Nam), "2026-10-27 14:30[:05]" (giờ Việt Nam),
 * hoặc ISO có múi giờ ("2026-10-27T07:30:00Z", "...+07:00"). Không đoán các dạng khác.
 */
export function parseOrderTime(raw: string): Date | null {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  const local = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(raw);
  const zoned = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.exec(raw);
  const parts = dateOnly ?? local;
  if (parts) {
    const [y, mo, d, h = 0, mi = 0, s = 0] = parts.slice(1).map((p) => (p === undefined ? 0 : Number(p)));
    const utc = Date.UTC(y, mo - 1, d, h, mi, s) - VN_OFFSET_MS;
    const back = new Date(utc + VN_OFFSET_MS);
    if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d || back.getUTCHours() !== h || back.getUTCMinutes() !== mi) {
      return null;
    }
    return new Date(utc);
  }
  if (zoned) {
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

export function normalizeConversionRow(raw: Record<string, string | undefined>, now: Date): ConversionRowResult {
  const errors: string[] = [];

  const externalOrderId = clean(raw.order_id);
  if (!externalOrderId) {
    errors.push('Thiếu order_id.');
  } else if (externalOrderId.length > 100) {
    errors.push('order_id dài quá 100 ký tự.');
  }

  const externalProductId = clean(raw.product_id);
  if (!externalProductId) {
    errors.push('Thiếu product_id.');
  } else if (externalProductId.length > 100) {
    errors.push('product_id dài quá 100 ký tự.');
  }

  let orderTime: Date | null = null;
  const rawTime = clean(raw.order_time);
  if (!rawTime) {
    errors.push('Thiếu order_time.');
  } else {
    orderTime = parseOrderTime(rawTime);
    if (!orderTime) {
      errors.push('order_time không hợp lệ (dùng 2026-10-27, 2026-10-27 14:30 hoặc ISO có múi giờ).');
    } else if (orderTime.getTime() > now.getTime() + MAX_FUTURE_MS) {
      errors.push('order_time nằm ở tương lai.');
      orderTime = null;
    }
  }

  let status: ConversionStatus | null = null;
  const rawStatus = clean(raw.status);
  if (!rawStatus) {
    errors.push('Thiếu status.');
  } else {
    status = STATUS_MAP[rawStatus.toLowerCase()] ?? null;
    if (!status) {
      errors.push('status phải là pending, completed hoặc cancelled.');
    }
  }

  let commissionAmount: number | null = null;
  const rawCommission = clean(raw.commission);
  if (rawCommission !== null) {
    if (!DECIMAL.test(rawCommission) || Number(rawCommission) > MAX_COMMISSION) {
      errors.push('commission không hợp lệ (chỉ nhập số, tối đa 2 chữ số thập phân sau dấu chấm, không dùng dấu phân cách hàng nghìn; ví dụ 15000).');
    } else {
      commissionAmount = Number(rawCommission);
    }
  }

  let currency: string | null = null;
  const rawCurrency = clean(raw.currency);
  if (rawCurrency !== null) {
    if (/^[A-Za-z]{3}$/.test(rawCurrency)) {
      currency = rawCurrency.toUpperCase();
    } else {
      errors.push('currency phải là mã 3 chữ cái (ví dụ VND).');
    }
  }
  if (commissionAmount !== null && currency === null && rawCurrency === null) {
    // Không tự đoán đơn vị tiền tệ.
    errors.push('Có commission thì phải có currency.');
  }

  let subId: string | null = null;
  const rawSubId = clean(raw.sub_id);
  if (rawSubId !== null) {
    if (/^[A-Za-z0-9_-]{1,50}$/.test(rawSubId)) {
      subId = rawSubId;
    } else {
      errors.push('sub_id chỉ gồm chữ, số, gạch ngang, gạch dưới (tối đa 50 ký tự).');
    }
  }

  if (errors.length > 0 || !externalOrderId || !externalProductId || !orderTime || !status) {
    return { ok: false, errors };
  }
  return { ok: true, value: { externalOrderId, externalProductId, orderTime, status, commissionAmount, currency, subId } };
}

// ---------- Số liệu bài ----------

export const METRIC_FIELDS = ['views', 'likes', 'replies', 'reposts', 'quotes'] as const;
export type MetricField = (typeof METRIC_FIELDS)[number];
export type MetricValues = Record<MetricField, number | null>;

/** Ít nhất một số liệu; mỗi số là số nguyên không âm. Trường bỏ trống = chưa biết (NULL), không phải 0. */
export function validateMetricInput(input: Partial<Record<MetricField, number | null | undefined>>): { ok: true; values: MetricValues } | { ok: false; reason: string } {
  const values = {} as MetricValues;
  let provided = 0;
  for (const field of METRIC_FIELDS) {
    const v = input[field];
    if (v === undefined || v === null) {
      values[field] = null;
      continue;
    }
    if (!Number.isInteger(v) || v < 0 || v > MAX_METRIC) {
      return { ok: false, reason: `${field} phải là số nguyên từ 0 đến ${MAX_METRIC}.` };
    }
    values[field] = v;
    provided += 1;
  }
  if (provided === 0) {
    return { ok: false, reason: 'Hãy nhập ít nhất một số liệu.' };
  }
  return { ok: true, values };
}

// ---------- Báo cáo ----------

export interface ReportPost {
  publishedPostId: string;
  contentPostId: string;
  productId: string;
  affiliateLinkId: string;
  socialAccountId: string;
  publishedAt: Date;
}

export interface ReportMetric extends MetricValues {
  publishedPostId: string;
  capturedAt: Date;
  source: 'MANUAL' | 'API';
}

export interface ReportConversion {
  externalOrderId: string;
  externalProductId: string;
  orderTime: Date;
  status: ConversionStatus;
  commissionAmount: number | null;
  currency: string | null;
  subId: string | null;
}

export interface ReportLink {
  id: string;
  productId: string;
  subId: string | null;
}

export interface ReportProduct {
  id: string;
  externalProductId: string;
  name: string;
}

export type UnattributedReason =
  | 'NO_SUBID'
  | 'SUBID_UNKNOWN'
  | 'SUBID_AMBIGUOUS_LINK'
  | 'LINK_NO_PUBLISHED_POST'
  | 'LINK_MULTIPLE_POSTS'
  | 'BEFORE_PUBLISH';

export const UNATTRIBUTED_REASON_TEXT: Record<UnattributedReason, string> = {
  NO_SUBID: 'Đơn không có sub_id nên không biết thuộc bài nào.',
  SUBID_UNKNOWN: 'sub_id không khớp link nào trong hệ thống.',
  SUBID_AMBIGUOUS_LINK: 'sub_id trùng nhiều link khác nhau.',
  LINK_NO_PUBLISHED_POST: 'Link này chưa được dùng trong bài nào đã đăng.',
  LINK_MULTIPLE_POSTS: 'Link này được dùng trong nhiều bài đã đăng nên không biết bài nào.',
  BEFORE_PUBLISH: 'Đơn phát sinh trước khi bài được đăng.',
};

export interface MoneyByCurrency {
  [currency: string]: { confirmed: number; pending: number };
}

export interface OrderStats {
  pending: number;
  completed: number;
  cancelled: number;
  /** Đơn pending/completed không có số hoa hồng (chưa biết). */
  commissionUnknown: number;
  commission: MoneyByCurrency;
}

export interface ReportPostRow {
  publishedPostId: string;
  contentPostId: string;
  productId: string;
  publishedAt: Date;
  /** Số liệu mới nhất; NULL từng trường = chưa biết. null = chưa nhập lần nào. */
  metrics: ReportMetric | null;
  orders: OrderStats;
}

export interface UnattributedGroup {
  productKey: string;
  productName: string | null;
  reasons: Partial<Record<UnattributedReason, number>>;
  orders: OrderStats;
}

export interface Report {
  posts: ReportPostRow[];
  unattributed: UnattributedGroup[];
  totals: {
    publishedPosts: number;
    postsWithMetrics: number;
    attributed: OrderStats;
    unattributed: OrderStats;
    /** Tổng chỉ cộng các bài ĐÃ biết số đó; bài chưa nhập không tính như 0. */
    views: { total: number; knownPosts: number };
  };
}

function emptyStats(): OrderStats {
  return { pending: 0, completed: 0, cancelled: 0, commissionUnknown: 0, commission: {} };
}

function addOrder(stats: OrderStats, c: ReportConversion): void {
  if (c.status === 'PENDING') {
    stats.pending += 1;
  } else if (c.status === 'COMPLETED') {
    stats.completed += 1;
  } else {
    stats.cancelled += 1;
    return; // đơn hủy không có hoa hồng
  }
  if (c.commissionAmount === null || c.currency === null) {
    stats.commissionUnknown += 1;
    return;
  }
  const bucket = (stats.commission[c.currency] ??= { confirmed: 0, pending: 0 });
  const key = c.status === 'COMPLETED' ? 'confirmed' : 'pending';
  // Làm tròn 2 chữ số để tránh sai số dấu phẩy động khi cộng nhiều đơn.
  bucket[key] = Math.round((bucket[key] + c.commissionAmount) * 100) / 100;
}

function mergeStats(into: OrderStats, from: OrderStats): void {
  into.pending += from.pending;
  into.completed += from.completed;
  into.cancelled += from.cancelled;
  into.commissionUnknown += from.commissionUnknown;
  for (const [currency, money] of Object.entries(from.commission)) {
    const bucket = (into.commission[currency] ??= { confirmed: 0, pending: 0 });
    bucket.confirmed = Math.round((bucket.confirmed + money.confirmed) * 100) / 100;
    bucket.pending = Math.round((bucket.pending + money.pending) * 100) / 100;
  }
}

/**
 * Gắn đơn hàng vào bài CHỈ khi đủ căn cứ: sub_id khớp đúng một link, link đó được dùng trong đúng một bài đã đăng,
 * và đơn phát sinh sau khi bài được đăng. Còn lại để vào nhóm "chưa gắn được" kèm lý do, theo sản phẩm.
 */
export function buildReport(input: {
  posts: ReportPost[];
  metrics: ReportMetric[];
  conversions: ReportConversion[];
  links: ReportLink[];
  products: ReportProduct[];
  from: Date;
  to: Date;
}): Report {
  const latest = new Map<string, ReportMetric>();
  for (const m of input.metrics) {
    const prev = latest.get(m.publishedPostId);
    if (!prev || m.capturedAt.getTime() > prev.capturedAt.getTime()) {
      latest.set(m.publishedPostId, m);
    }
  }

  const linksBySub = new Map<string, ReportLink[]>();
  for (const l of input.links) {
    if (l.subId) {
      linksBySub.set(l.subId, [...(linksBySub.get(l.subId) ?? []), l]);
    }
  }
  const postsByLink = new Map<string, ReportPost[]>();
  for (const p of input.posts) {
    postsByLink.set(p.affiliateLinkId, [...(postsByLink.get(p.affiliateLinkId) ?? []), p]);
  }
  const productByExternal = new Map(input.products.map((p) => [p.externalProductId, p]));

  const inRange = input.conversions.filter((c) => c.orderTime >= input.from && c.orderTime < input.to);
  const perPost = new Map<string, OrderStats>();
  const groups = new Map<string, UnattributedGroup>();
  const attributedTotal = emptyStats();
  const unattributedTotal = emptyStats();

  for (const c of inRange) {
    let reason: UnattributedReason | null = null;
    let post: ReportPost | null = null;
    if (!c.subId) {
      reason = 'NO_SUBID';
    } else {
      const links = linksBySub.get(c.subId) ?? [];
      if (links.length === 0) {
        reason = 'SUBID_UNKNOWN';
      } else if (links.length > 1) {
        reason = 'SUBID_AMBIGUOUS_LINK';
      } else {
        const candidates = postsByLink.get(links[0].id) ?? [];
        if (candidates.length === 0) {
          reason = 'LINK_NO_PUBLISHED_POST';
        } else if (candidates.length > 1) {
          reason = 'LINK_MULTIPLE_POSTS';
        } else if (c.orderTime < candidates[0].publishedAt) {
          reason = 'BEFORE_PUBLISH';
        } else {
          post = candidates[0];
        }
      }
    }

    if (post) {
      const stats = perPost.get(post.publishedPostId) ?? emptyStats();
      addOrder(stats, c);
      perPost.set(post.publishedPostId, stats);
      addOrder(attributedTotal, c);
    } else if (reason) {
      const product = productByExternal.get(c.externalProductId) ?? null;
      const group = groups.get(c.externalProductId) ?? {
        productKey: c.externalProductId,
        productName: product?.name ?? null,
        reasons: {},
        orders: emptyStats(),
      };
      group.reasons[reason] = (group.reasons[reason] ?? 0) + 1;
      addOrder(group.orders, c);
      groups.set(c.externalProductId, group);
      addOrder(unattributedTotal, c);
    }
  }

  const rows: ReportPostRow[] = input.posts
    .filter((p) => (p.publishedAt >= input.from && p.publishedAt < input.to) || perPost.has(p.publishedPostId))
    .map((p) => ({
      publishedPostId: p.publishedPostId,
      contentPostId: p.contentPostId,
      productId: p.productId,
      publishedAt: p.publishedAt,
      metrics: latest.get(p.publishedPostId) ?? null,
      orders: perPost.get(p.publishedPostId) ?? emptyStats(),
    }))
    .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());

  const viewsKnown = rows.filter((r) => r.metrics?.views !== null && r.metrics?.views !== undefined);
  const unattributedList = [...groups.values()].sort(
    (a, b) => b.orders.completed + b.orders.pending - (a.orders.completed + a.orders.pending),
  );
  const unattrMerged = emptyStats();
  mergeStats(unattrMerged, unattributedTotal);

  return {
    posts: rows,
    unattributed: unattributedList,
    totals: {
      publishedPosts: rows.length,
      postsWithMetrics: rows.filter((r) => r.metrics !== null).length,
      attributed: attributedTotal,
      unattributed: unattrMerged,
      views: { total: viewsKnown.reduce((sum, r) => sum + (r.metrics?.views ?? 0), 0), knownPosts: viewsKnown.length },
    },
  };
}
