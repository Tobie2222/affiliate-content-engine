import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../api/useApi';
import { ConversionImportPanel } from '../analytics/ConversionImportPanel';
import { MetricsForm } from '../analytics/MetricsForm';
import {
  METRIC_KEYS,
  METRIC_LABEL,
  RANGE_OPTIONS,
  canWriteAnalytics,
  commissionLines,
  formatMetric,
  hasOrders,
  ordersText,
  rangeQuery,
  reasonsText,
  type ApiReport,
  type OrderStats,
} from '../analytics/analytics';
import { formatVN } from '../publishing/publishing';
import { useOrg } from '../org/OrgContext';

export function AnalyticsPage() {
  const { current } = useOrg();
  const orgId = current?.id ?? null;
  const [days, setDays] = useState<number>(30);
  const [showImport, setShowImport] = useState(false);
  const [entering, setEntering] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Mốc "bây giờ" cố định theo lần chọn khoảng để đường dẫn không đổi mỗi lần render (tránh tải lặp).
  const query = useMemo(() => rangeQuery(days, new Date()), [days]);
  const report = useApi<ApiReport>(orgId ? `/organizations/${orgId}/analytics/report?${query}` : null);

  if (!current || !orgId) {
    return null;
  }
  const writer = canWriteAnalytics(current.role);
  const data = report.data;

  function finish(message: string) {
    setShowImport(false);
    setEntering(null);
    setNotice(message);
    void report.reload();
  }

  return (
    <div>
      <header className="page-head">
        <div>
          <h1>Số liệu</h1>
          <p className="muted">Số liệu bài đã đăng và đơn hàng affiliate.</p>
        </div>
        <div className="row">
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Khoảng thời gian">
            {RANGE_OPTIONS.map((o) => (
              <option key={o.days} value={o.days}>{o.label}</option>
            ))}
          </select>
          {writer && !showImport && (
            <button type="button" className="btn" onClick={() => setShowImport(true)}>Nhập đơn hàng (CSV)</button>
          )}
        </div>
      </header>

      <p className="notice notice-info" role="status">
        Số liệu bài do bạn nhập tay (chưa kết nối API Threads). Đơn hàng chỉ được gắn vào một bài khi sub_id của đơn khớp đúng một link và link đó chỉ dùng trong một bài đã đăng; các đơn còn lại nằm ở mục "Đơn chưa gắn được". Chỗ hiện "—" nghĩa là chưa biết, không phải 0.
      </p>
      {notice && <p className="notice notice-info" role="status">{notice}</p>}
      {report.error && !data && <p className="notice notice-error" role="alert">{report.error}</p>}

      {showImport && <ConversionImportPanel orgId={orgId} onImported={finish} onCancel={() => setShowImport(false)} />}

      {!data && !report.error && <p className="muted">Đang tải…</p>}

      {data && (
        <>
          <div className="grid-3">
            <Stat title="Bài đã đăng" value={String(data.totals.publishedPosts)} note={`${data.totals.postsWithMetrics} bài đã có số liệu`} />
            <Stat
              title="Lượt xem"
              value={data.totals.views.knownPosts > 0 ? formatMetric(data.totals.views.total) : '—'}
              note={
                data.totals.views.knownPosts > 0
                  ? `Chỉ cộng ${data.totals.views.knownPosts}/${data.totals.publishedPosts} bài đã nhập lượt xem`
                  : 'Chưa nhập lượt xem bài nào'
              }
            />
            <OrdersStat title="Đơn gắn được vào bài" stats={data.totals.attributed} />
          </div>

          <section className="card">
            <h2>Bài đã đăng</h2>
            {data.posts.length === 0 && <p className="muted">Chưa có bài nào được đăng trong khoảng này.</p>}
            <ul className="post-rows">
              {data.posts.map((row) => (
                <li key={row.publishedPostId}>
                  <div className="row between">
                    <span>
                      <Link to={`/content/${row.contentPostId}`}>Bài đăng {formatVN(row.publishedAt)}</Link>
                    </span>
                    {writer && entering !== row.publishedPostId && (
                      <button type="button" className="btn btn-small" onClick={() => setEntering(row.publishedPostId)}>Nhập số liệu</button>
                    )}
                  </div>
                  {row.metrics ? (
                    <dl className="metric-line">
                      {METRIC_KEYS.map((k) => (
                        <div key={k}>
                          <dt>{METRIC_LABEL[k]}</dt>
                          <dd>{formatMetric(row.metrics?.[k])}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : (
                    <p className="muted small">Chưa nhập số liệu.</p>
                  )}
                  {row.metrics && <p className="muted small">Số liệu ghi nhận lúc {formatVN(row.metrics.capturedAt)}.</p>}
                  <p className="small">
                    <strong>Đơn:</strong> {ordersText(row.orders)}
                    {commissionLines(row.orders).map((line) => (
                      <span key={line}> · {line}</span>
                    ))}
                    {row.orders.commissionUnknown > 0 && <span> · {row.orders.commissionUnknown} đơn chưa biết hoa hồng</span>}
                  </p>
                  {entering === row.publishedPostId && (
                    <MetricsForm orgId={orgId} publishedPostId={row.publishedPostId} onDone={finish} onCancel={() => setEntering(null)} />
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section className="card">
            <h2>Đơn chưa gắn được vào bài</h2>
            <OrdersLine stats={data.totals.unattributed} />
            {data.unattributed.length === 0 && <p className="muted">Không có đơn nào chưa gắn được.</p>}
            <ul className="post-rows">
              {data.unattributed.map((g) => (
                <li key={g.productKey}>
                  <p><strong>{g.productName ?? `Sản phẩm ${g.productKey} (chưa có trong danh mục)`}</strong></p>
                  <p className="small">{ordersText(g.orders)}{commissionLines(g.orders).map((line) => <span key={line}> · {line}</span>)}</p>
                  <ul className="reason-list small muted">
                    {reasonsText(g.reasons).map((text) => <li key={text}>{text}</li>)}
                  </ul>
                </li>
              ))}
            </ul>
            {data.unattributed.length > 0 && (
              <p className="muted small">
                Muốn gắn đơn vào bài: tạo mỗi bài một link Shopee riêng với sub_id riêng, nhập sub_id đó khi thêm link ở trang Sản phẩm, và để cột sub_id trong báo cáo đơn hàng.
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Stat({ title, value, note }: { title: string; value: string; note: string }) {
  return (
    <section className="card stat">
      <p className="muted small">{title}</p>
      <p className="stat-value">{value}</p>
      <p className="muted small">{note}</p>
    </section>
  );
}

function OrdersStat({ title, stats }: { title: string; stats: OrderStats }) {
  const lines = commissionLines(stats);
  return (
    <section className="card stat">
      <p className="muted small">{title}</p>
      <p className="stat-value">{hasOrders(stats) ? ordersText(stats) : 'Chưa có đơn'}</p>
      {lines.map((line) => (
        <p key={line} className="muted small">{line}</p>
      ))}
      {stats.commissionUnknown > 0 && <p className="muted small">{stats.commissionUnknown} đơn chưa biết hoa hồng</p>}
    </section>
  );
}

function OrdersLine({ stats }: { stats: OrderStats }) {
  return (
    <p className="small">
      {ordersText(stats)}
      {commissionLines(stats).map((line) => <span key={line}> · {line}</span>)}
      {stats.commissionUnknown > 0 && <span> · {stats.commissionUnknown} đơn chưa biết hoa hồng</span>}
    </p>
  );
}
