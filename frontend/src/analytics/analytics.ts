import type { Role } from '../org/OrgContext';

export type Money = Record<string, { confirmed: number; pending: number }>;

export interface OrderStats {
  pending: number;
  completed: number;
  cancelled: number;
  commissionUnknown: number;
  commission: Money;
}

export interface PostMetrics {
  views: number | null;
  likes: number | null;
  replies: number | null;
  reposts: number | null;
  quotes: number | null;
  capturedAt: string;
  source: 'MANUAL' | 'API';
}

export interface ReportPostRow {
  publishedPostId: string;
  contentPostId: string;
  productId: string;
  publishedAt: string;
  metrics: PostMetrics | null;
  orders: OrderStats;
}

export type UnattributedReason =
  | 'NO_SUBID'
  | 'SUBID_UNKNOWN'
  | 'SUBID_AMBIGUOUS_LINK'
  | 'LINK_NO_PUBLISHED_POST'
  | 'LINK_MULTIPLE_POSTS'
  | 'BEFORE_PUBLISH';

export interface UnattributedGroup {
  productKey: string;
  productName: string | null;
  reasons: Partial<Record<UnattributedReason, number>>;
  orders: OrderStats;
}

export interface ApiReport {
  from: string;
  to: string;
  posts: ReportPostRow[];
  unattributed: UnattributedGroup[];
  totals: {
    publishedPosts: number;
    postsWithMetrics: number;
    attributed: OrderStats;
    unattributed: OrderStats;
    views: { total: number; knownPosts: number };
  };
}

export interface ConversionImportResult {
  dryRun: boolean;
  totalRows: number;
  valid: number;
  invalid: number;
  created: number;
  updated: number;
  unchanged: number;
  errors: Array<{ line: number; errors: string[] }>;
  ignoredColumns: string[];
}

/** Khớp ROLE_PERMISSIONS ở máy chủ (analytics.write: OWNER, ADMIN, ANALYST). Máy chủ vẫn kiểm tra lại. */
export function canWriteAnalytics(role: Role): boolean {
  return role === 'OWNER' || role === 'ADMIN' || role === 'ANALYST';
}

export const REASON_TEXT: Record<UnattributedReason, string> = {
  NO_SUBID: 'Đơn không có sub_id nên không biết thuộc bài nào',
  SUBID_UNKNOWN: 'sub_id không khớp link nào trong hệ thống',
  SUBID_AMBIGUOUS_LINK: 'sub_id trùng nhiều link khác nhau',
  LINK_NO_PUBLISHED_POST: 'Link này chưa được dùng trong bài nào đã đăng',
  LINK_MULTIPLE_POSTS: 'Link này được dùng trong nhiều bài đã đăng nên không biết bài nào',
  BEFORE_PUBLISH: 'Đơn phát sinh trước khi bài được đăng',
};

export const CSV_TEMPLATE =
  'order_id,product_id,order_time,status,commission,currency,sub_id\nDH0001,SP001,2026-10-27 14:30,completed,15000,VND,bai-001';

export const MAX_CSV_CHARS = 50_000;

// ---------- Hiển thị: chưa biết khác 0 ----------

export function formatMetric(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : new Intl.NumberFormat('vi-VN').format(value);
}

const CURRENCY_SYMBOL: Record<string, string> = { VND: '₫', USD: '$' };

export function formatMoney(amount: number, currency: string): string {
  const n = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(amount);
  return `${n} ${CURRENCY_SYMBOL[currency] ?? currency}`;
}

/** "10.000 ₫ đã chốt, 5.000 ₫ chờ" cho từng loại tiền; không cộng lẫn các loại tiền. Rỗng nếu chưa có số nào. */
export function commissionLines(stats: OrderStats): string[] {
  return Object.entries(stats.commission).map(([currency, m]) => {
    const parts = [`${formatMoney(m.confirmed, currency)} đã chốt`];
    if (m.pending > 0) {
      parts.push(`${formatMoney(m.pending, currency)} chờ`);
    }
    return parts.join(', ');
  });
}

export function ordersText(stats: OrderStats): string {
  const parts: string[] = [];
  if (stats.completed > 0) {
    parts.push(`${stats.completed} hoàn tất`);
  }
  if (stats.pending > 0) {
    parts.push(`${stats.pending} chờ`);
  }
  if (stats.cancelled > 0) {
    parts.push(`${stats.cancelled} hủy`);
  }
  return parts.length > 0 ? parts.join(', ') : 'Chưa có đơn';
}

export function hasOrders(stats: OrderStats): boolean {
  return stats.completed + stats.pending + stats.cancelled > 0;
}

export function reasonsText(reasons: UnattributedGroup['reasons']): string[] {
  return (Object.entries(reasons) as Array<[UnattributedReason, number]>).map(([reason, n]) => `${n} đơn: ${REASON_TEXT[reason]}`);
}

// ---------- Khoảng thời gian ----------

export const RANGE_OPTIONS = [
  { days: 7, label: '7 ngày qua' },
  { days: 30, label: '30 ngày qua' },
  { days: 90, label: '90 ngày qua' },
] as const;

export function rangeQuery(days: number, now: Date): string {
  const to = new Date(now.getTime() + 60_000);
  const from = new Date(to.getTime() - days * 86_400_000);
  return `from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;
}

// ---------- Form nhập số liệu ----------

export const METRIC_KEYS = ['views', 'likes', 'replies', 'reposts', 'quotes'] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];
export const METRIC_LABEL: Record<MetricKey, string> = {
  views: 'Lượt xem',
  likes: 'Lượt thích',
  replies: 'Trả lời',
  reposts: 'Đăng lại',
  quotes: 'Trích dẫn',
};
const MAX_METRIC = 1_000_000_000;

export type MetricForm = Record<MetricKey, string>;

export const EMPTY_METRIC_FORM: MetricForm = { views: '', likes: '', replies: '', reposts: '', quotes: '' };

/** Ô trống = chưa biết (không gửi), không phải 0. Chỉ nhận số nguyên thuần: "1.200" bị từ chối vì dễ hiểu nhầm. */
export function buildMetricPayload(form: MetricForm): { ok: true; payload: Partial<Record<MetricKey, number>> } | { ok: false; error: string } {
  const payload: Partial<Record<MetricKey, number>> = {};
  for (const key of METRIC_KEYS) {
    const raw = form[key].trim();
    if (raw === '') {
      continue;
    }
    if (!/^\d+$/.test(raw) || Number(raw) > MAX_METRIC) {
      return { ok: false, error: `${METRIC_LABEL[key]} phải là số nguyên không âm, không dùng dấu chấm hay phẩy.` };
    }
    payload[key] = Number(raw);
  }
  if (Object.keys(payload).length === 0) {
    return { ok: false, error: 'Hãy nhập ít nhất một số liệu. Ô để trống nghĩa là chưa biết.' };
  }
  return { ok: true, payload };
}

export function summarizeConversionImport(r: ConversionImportResult): string {
  if (r.dryRun) {
    return `Kiểm tra ${r.totalRows} dòng: ${r.valid} hợp lệ, ${r.invalid} lỗi. Sẽ thêm mới ${r.created}, cập nhật ${r.updated}, không đổi ${r.unchanged}. Chưa ghi gì vào hệ thống.`;
  }
  return `Xử lý ${r.totalRows} dòng: thêm mới ${r.created}, cập nhật ${r.updated}, không đổi ${r.unchanged}, lỗi ${r.invalid}.`;
}
