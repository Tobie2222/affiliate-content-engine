import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useApi } from '../api/useApi';
import type { Page } from '../content/content';
import { AssetFormPanel } from '../media/AssetFormPanel';
import {
  LICENSE_STATUS_LABEL,
  LICENSE_STATUS_TONE,
  STATUS_FILTERS,
  canReviewMedia,
  canWriteMedia,
  listExpiryText,
  summarizeRecheck,
  type ApiAsset,
  type AssetLicenseStatus,
  type MediaType,
  type RecheckResult,
} from '../media/media';
import { useOrg } from '../org/OrgContext';
import { Badge } from '../ui/Badge';

const PAGE_SIZE = 20;

export function MediaPage() {
  const { current } = useOrg();
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<AssetLicenseStatus | ''>('');
  const [type, setType] = useState<MediaType | ''>('');
  const [archived, setArchived] = useState(false);
  const [offset, setOffset] = useState(0);

  const orgId = current?.id ?? null;
  const query = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
  if (status) {
    query.set('licenseStatus', status);
  }
  if (type) {
    query.set('mediaType', type);
  }
  if (archived) {
    query.set('includeArchived', 'true');
  }
  const assets = useApi<Page<ApiAsset>>(orgId ? `/organizations/${orgId}/media/assets?${query.toString()}` : null);

  if (!current || !orgId) {
    return null;
  }
  const writer = canWriteMedia(current.role);
  const reviewer = canReviewMedia(current.role);
  const total = assets.data?.total ?? 0;
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + PAGE_SIZE, total);
  const now = new Date();

  async function recheck() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api<RecheckResult>(`/organizations/${orgId}/media/assets/recheck`, { method: 'POST' });
      setNotice(summarizeRecheck(result));
      await assets.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không kiểm tra lại được.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <header className="page-head">
        <div>
          <h1>Media</h1>
          <p className="muted">
            Ảnh và video dùng trong bài. Mỗi media cần giấy phép được người có quyền duyệt xác nhận; giấy phép hết hạn thì media tự bị chặn.
          </p>
        </div>
        <div className="row">
          {writer && <button type="button" className="btn btn-primary" onClick={() => { setNotice(null); setAdding(true); }}>Thêm media</button>}
          {reviewer && <button type="button" className="btn" disabled={busy} onClick={() => void recheck()}>{busy ? 'Đang kiểm tra…' : 'Kiểm tra lại giấy phép'}</button>}
        </div>
      </header>

      {notice && <p className="notice notice-info" role="status">{notice}</p>}
      {error && <p className="notice notice-error" role="alert">{error}</p>}

      {adding && (
        <AssetFormPanel orgId={orgId} onCancel={() => setAdding(false)} onDone={(asset) => navigate(`/media/${asset.id}`)} />
      )}

      <section className="card list-card" aria-label="Danh sách media">
        <div className="list-toolbar">
          <div className="row filters">
            <label className="inline-field">
              Giấy phép
              <select value={status} onChange={(e) => { setStatus(e.target.value as AssetLicenseStatus | ''); setOffset(0); }}>
                <option value="">Tất cả</option>
                {STATUS_FILTERS.map((s) => (
                  <option key={s} value={s}>{LICENSE_STATUS_LABEL[s]}</option>
                ))}
              </select>
            </label>
            <label className="inline-field">
              Loại
              <select value={type} onChange={(e) => { setType(e.target.value as MediaType | ''); setOffset(0); }}>
                <option value="">Tất cả</option>
                <option value="IMAGE">Ảnh</option>
                <option value="VIDEO">Video</option>
              </select>
            </label>
            <label className="inline-field check-inline">
              <input type="checkbox" checked={archived} onChange={(e) => { setArchived(e.target.checked); setOffset(0); }} />
              Gồm media đã lưu trữ
            </label>
          </div>
          <span className="muted small">
            {assets.loading ? 'Đang tải…' : total === 0 ? 'Chưa có media' : `${from}-${to} / ${total} media`}
          </span>
        </div>

        {assets.error && (
          <div>
            <p className="notice notice-error" role="alert">{assets.error}</p>
            <button type="button" className="btn" onClick={() => void assets.reload()}>Thử lại</button>
          </div>
        )}

        {!assets.error && assets.data && assets.data.items.length === 0 && (
          <p className="muted empty">
            {status || type || archived ? 'Không có media nào khớp bộ lọc.' : writer ? 'Chưa có media. Bấm "Thêm media" để khai báo ảnh hoặc video đầu tiên.' : 'Chưa có media.'}
          </p>
        )}

        <ul className="post-list">
          {(assets.data?.items ?? []).map((a) => (
            <li key={a.id}>
              <Link to={`/media/${a.id}`} className="post-row">
                <div className="post-row-main">
                  <p className="post-excerpt">{a.title}</p>
                  <p className="muted small">
                    {[a.mediaType === 'IMAGE' ? 'Ảnh' : 'Video', listExpiryText(a, now)].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <div className="post-row-meta">
                  {a.assetStatus === 'ARCHIVED' && <Badge>Đã lưu trữ</Badge>}
                  <Badge tone={LICENSE_STATUS_TONE[a.licenseStatus]}>{LICENSE_STATUS_LABEL[a.licenseStatus]}</Badge>
                </div>
              </Link>
            </li>
          ))}
        </ul>

        {total > PAGE_SIZE && (
          <div className="row pager">
            <button type="button" className="btn btn-small" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Trang trước</button>
            <button type="button" className="btn btn-small" disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>Trang sau</button>
          </div>
        )}
        <p className="muted small list-foot">
          Trạng thái trong danh sách là kết quả của lần kiểm tra gần nhất. Trang chi tiết và khâu QA bài viết luôn tính lại theo thời điểm hiện tại.
        </p>
      </section>
    </div>
  );
}
