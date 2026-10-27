import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useApi } from '../api/useApi';
import { useAuth } from '../auth/AuthContext';
import type { ProductItem } from '../content/catalog';
import { StatusBadge, VerdictBadge } from '../content/Badges';
import { Composer } from '../content/Composer';
import {
  STATUS_FILTERS,
  STATUS_LABEL,
  canManageOrg,
  canWriteContent,
  excerpt,
  originLabel,
  qaVerdict,
  type ApiPost,
  type Page,
  type PostStatus,
} from '../content/content';
import { useOrg } from '../org/OrgContext';

const PAGE_SIZE = 20;

export function ContentPage() {
  const { current } = useOrg();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState<PostStatus | ''>('');
  const [offset, setOffset] = useState(0);
  const [composing, setComposing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const orgId = current?.id ?? null;
  const query = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
  if (status) {
    query.set('status', status);
  }
  const posts = useApi<Page<ApiPost>>(orgId ? `/organizations/${orgId}/content/posts?${query.toString()}` : null);
  const products = useApi<Page<ProductItem>>(orgId ? `/organizations/${orgId}/products?limit=100` : null);
  const settings = useApi<{ separationOfDuties: boolean }>(orgId ? `/organizations/${orgId}/settings` : null);

  const productName = useMemo(() => {
    const map = new Map<string, string>();
    (products.data?.items ?? []).forEach((p) => map.set(p.id, p.name));
    return map;
  }, [products.data]);

  if (!current || !orgId) {
    return null;
  }
  const writer = canWriteContent(current.role);
  const total = posts.data?.total ?? 0;
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + PAGE_SIZE, total);

  return (
    <div>
      <header className="page-head">
        <div>
          <h1>Bài viết</h1>
          <p className="muted">
            Soạn bài, xem báo cáo QA và duyệt. Mọi bài đều cần người có quyền duyệt xác nhận trước khi đi tiếp; AI chỉ đề xuất.
          </p>
        </div>
        {writer && !composing && (
          <button type="button" className="btn btn-primary" onClick={() => { setNotice(null); setComposing(true); }}>
            Tạo bài mới
          </button>
        )}
      </header>

      {notice && <p className="notice notice-info" role="status">{notice}</p>}

      {composing && products.data && (
        <Composer
          orgId={orgId}
          products={products.data.items}
          onCancel={() => setComposing(false)}
          onCreated={({ message, postId }) => {
            setComposing(false);
            if (postId) {
              navigate(`/content/${postId}`);
              return;
            }
            setNotice(message);
            setOffset(0);
            void posts.reload();
          }}
        />
      )}
      {composing && !products.data && <p className="muted">Đang tải sản phẩm…</p>}

      {canManageOrg(current.role) && settings.data && (
        <SeparationToggle
          orgId={orgId}
          value={settings.data.separationOfDuties}
          onChanged={() => void settings.reload()}
        />
      )}

      <section className="card list-card" aria-label="Danh sách bài viết">
        <div className="list-toolbar">
          <label className="inline-field">
            Trạng thái
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as PostStatus | '');
                setOffset(0);
              }}
            >
              <option value="">Tất cả</option>
              {STATUS_FILTERS.map((s) => (
                <option key={s} value={s}>{STATUS_LABEL[s]}</option>
              ))}
            </select>
          </label>
          <span className="muted small">
            {posts.loading ? 'Đang tải…' : total === 0 ? 'Chưa có bài nào' : `${from}-${to} / ${total} bài`}
          </span>
        </div>

        {posts.error && (
          <div>
            <p className="notice notice-error" role="alert">{posts.error}</p>
            <button type="button" className="btn" onClick={() => void posts.reload()}>Thử lại</button>
          </div>
        )}

        {!posts.error && posts.data && posts.data.items.length === 0 && (
          <p className="muted empty">
            {status ? 'Không có bài nào ở trạng thái này.' : writer ? 'Chưa có bài viết nào. Bấm "Tạo bài mới" để bắt đầu.' : 'Chưa có bài viết nào.'}
          </p>
        )}

        <ul className="post-list">
          {(posts.data?.items ?? []).map((post) => (
            <li key={post.id}>
              <Link to={`/content/${post.id}`} className="post-row">
                <div className="post-row-main">
                  <p className="post-excerpt">{excerpt(post.body)}</p>
                  <p className="muted small">
                    {productName.get(post.productId) ?? 'Sản phẩm'} · {originLabel(post)}
                    {post.authorId !== null && post.authorId === user?.id ? ' · Bạn là người soạn' : ''}
                  </p>
                </div>
                <div className="post-row-meta">
                  <StatusBadge status={post.status} />
                  <VerdictBadge verdict={qaVerdict(post)} />
                  <span className="muted small">Phiên bản {post.contentVersion}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>

        {total > PAGE_SIZE && (
          <div className="row pager">
            <button type="button" className="btn btn-small" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
              Trang trước
            </button>
            <button type="button" className="btn btn-small" disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>
              Trang sau
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function SeparationToggle({ orgId, value, onChanged }: { orgId: string; value: boolean; onChanged(): void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function change(next: boolean) {
    setBusy(true);
    setError(null);
    try {
      await api(`/organizations/${orgId}/settings`, { method: 'PATCH', body: { separationOfDuties: next } });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không đổi được cài đặt.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card setting-card">
      <label className="check">
        <input type="checkbox" checked={value} disabled={busy} onChange={(e) => void change(e.target.checked)} />
        <span>
          <strong>Tách quyền: người soạn không tự duyệt bài của mình</strong>
          <small className="muted">
            {value
              ? 'Đang bật. Nếu bạn làm việc một mình, hãy tắt để tự duyệt bài của mình khi thử nghiệm; mỗi thay đổi đều được ghi nhật ký.'
              : 'Đang tắt: một người có thể vừa soạn vừa duyệt. Nên bật lại khi có người thứ hai.'}
          </small>
        </span>
      </label>
      {error && <p className="notice notice-error" role="alert">{error}</p>}
    </section>
  );
}
