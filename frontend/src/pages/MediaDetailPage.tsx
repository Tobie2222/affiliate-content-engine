import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { useApi } from '../api/useApi';
import { useAuth } from '../auth/AuthContext';
import { LicenseFormPanel } from '../media/LicenseFormPanel';
import {
  LICENSE_STATUS_LABEL,
  LICENSE_STATUS_TONE,
  LICENSE_TYPE_LABEL,
  REVIEW_LABEL,
  REVIEW_TONE,
  canReviewMedia,
  canWriteMedia,
  expiryText,
  validateLicenseReview,
  validityText,
  type ApiLicense,
  type AssetDetail,
} from '../media/media';
import { useOrg } from '../org/OrgContext';
import { Badge } from '../ui/Badge';
import { ConfirmButton } from '../ui/ConfirmButton';

interface Member {
  userId: string;
  displayName: string;
  email: string;
}

function dateText(value: string | null): string {
  return value === null ? '' : new Date(value).toLocaleDateString('vi-VN');
}

export function MediaDetailPage() {
  const { assetId } = useParams();
  const { current } = useOrg();
  const { user } = useAuth();
  const orgId = current?.id ?? null;
  const detail = useApi<AssetDetail>(orgId && assetId ? `/organizations/${orgId}/media/assets/${assetId}` : null);
  const members = useApi<Member[]>(orgId ? `/organizations/${orgId}/members` : null);
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const nameOf = useMemo(() => {
    const map = new Map<string, string>();
    (members.data ?? []).forEach((m) => map.set(m.userId, m.displayName || m.email));
    return (id: string | null): string => (id === null ? 'Không rõ' : id === user?.id ? 'Bạn' : (map.get(id) ?? 'Thành viên khác'));
  }, [members.data, user?.id]);

  if (!current || !orgId || !assetId) {
    return null;
  }
  if (detail.error && !detail.data) {
    return (
      <div>
        <p><Link to="/media">← Về danh sách media</Link></p>
        <p className="notice notice-error" role="alert">
          {detail.status === 404 || detail.status === 403 ? 'Không tìm thấy media này trong tổ chức hiện tại.' : detail.error}
        </p>
        <button type="button" className="btn" onClick={() => void detail.reload()}>Thử lại</button>
      </div>
    );
  }
  if (!detail.data) {
    return <p className="muted">Đang tải media…</p>;
  }

  const { asset, licenses, assessment } = detail.data;
  const writer = canWriteMedia(current.role);
  const reviewer = canReviewMedia(current.role);
  const active = asset.assetStatus === 'ACTIVE';
  const base = `/organizations/${orgId}/media`;
  const now = new Date();

  async function act(work: () => Promise<unknown>, success: string): Promise<boolean> {
    setBusy(true);
    setActionError(null);
    setMessage(null);
    try {
      await work();
      setMessage(success);
      return true;
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Thao tác thất bại.');
      return false;
    } finally {
      await detail.reload();
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="back"><Link to="/media">← Về danh sách media</Link></p>
      <header className="page-head">
        <div>
          <h1>{asset.title}</h1>
          <p className="muted">{asset.mediaType === 'IMAGE' ? 'Ảnh' : 'Video'}{asset.description ? ` · ${asset.description}` : ''}</p>
        </div>
        <div className="row">
          {!active && <Badge>Đã lưu trữ</Badge>}
          <Badge tone={LICENSE_STATUS_TONE[assessment.status]}>{LICENSE_STATUS_LABEL[assessment.status]}</Badge>
        </div>
      </header>

      {message && <p className="notice notice-info" role="status">{message}</p>}
      {actionError && <p className="notice notice-error" role="alert">{actionError}</p>}

      <div className="detail-grid">
        <div className="detail-main">
          <section className="card">
            <h2>Có dùng được trong bài không?</h2>
            <p className={assessment.usable && active ? 'usable-yes' : 'usable-no'}>
              {assessment.usable && active ? 'Có, dùng được lúc này.' : 'Chưa, media này chưa dùng được.'}
            </p>
            <p className="muted">{!active ? 'Media đã được lưu trữ.' : assessment.reason}</p>
            {assessment.usable && <p className="muted small">{expiryText(assessment.expiresAt, now)}</p>}
            {assessment.attributions.length > 0 && (
              <div className="notice notice-warn">
                <strong>Bắt buộc ghi nguồn.</strong> Bài dùng media này phải chứa nguyên văn:
                <ul>
                  {assessment.attributions.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
                QA sẽ chặn gửi duyệt nếu thiếu dòng này.
              </div>
            )}
            <p className="muted small">
              Kết quả được tính lại theo thời điểm hiện tại mỗi khi bạn mở trang này và mỗi khi QA bài viết chạy.
            </p>
          </section>

          <section className="card">
            <div className="card-head">
              <h2>Giấy phép</h2>
              {writer && active && !adding && (
                <button type="button" className="btn btn-small" onClick={() => { setMessage(null); setAdding(true); }}>Khai báo giấy phép</button>
              )}
            </div>
            {licenses.length === 0 && <p className="muted">Chưa có giấy phép nào. Hãy khai báo giấy phép để có thể dùng media này.</p>}
            <ul className="license-list">
              {licenses.map((l) => (
                <LicenseItem
                  key={l.id}
                  license={l}
                  nameOf={nameOf}
                  canReview={reviewer && l.reviewStatus === 'PENDING'}
                  busy={busy}
                  isBasis={l.id === assessment.basisLicenseId}
                  onReview={(decision, note) =>
                    act(
                      () => api(`${base}/licenses/${l.id}/review`, { method: 'POST', body: { decision, ...(note.trim() ? { note: note.trim() } : {}) } }),
                      decision === 'APPROVE' ? 'Đã duyệt giấy phép.' : 'Đã từ chối giấy phép.',
                    )
                  }
                />
              ))}
            </ul>
          </section>

          {adding && (
            <LicenseFormPanel
              orgId={orgId}
              assetId={asset.id}
              onCancel={() => setAdding(false)}
              onDone={() => {
                setAdding(false);
                setMessage('Đã gửi khai báo. Giấy phép đang chờ người có quyền duyệt xác nhận.');
                void detail.reload();
              }}
            />
          )}
        </div>

        <aside className="detail-side">
          <section className="card">
            <h2>Thông tin</h2>
            <dl className="facts single">
              <dt>Địa chỉ file</dt>
              <dd><a href={asset.sourceUrl} target="_blank" rel="noreferrer noopener">{asset.sourceUrl}</a></dd>
              <dt>Ngày thêm</dt>
              <dd>{dateText(asset.createdAt)}</dd>
            </dl>
            {writer && active && (
              <ConfirmButton
                label="Lưu trữ media"
                confirmLabel="Lưu trữ, không dùng nữa"
                disabled={busy}
                onConfirm={() => void act(() => api(`${base}/assets/${asset.id}/archive`, { method: 'POST' }), 'Đã lưu trữ media.')}
              />
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

function LicenseItem({
  license,
  nameOf,
  canReview,
  busy,
  isBasis,
  onReview,
}: {
  license: ApiLicense;
  nameOf(id: string | null): string;
  canReview: boolean;
  busy: boolean;
  isBasis: boolean;
  onReview(decision: 'APPROVE' | 'REJECT', note: string): Promise<boolean>;
}) {
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: 'APPROVE' | 'REJECT') {
    const problem = validateLicenseReview(decision, note);
    setError(problem);
    if (problem === null) {
      await onReview(decision, note);
    }
  }

  return (
    <li className="license">
      <div className="row license-head">
        <strong>{LICENSE_TYPE_LABEL[license.licenseType]}</strong>
        <Badge tone={REVIEW_TONE[license.reviewStatus]}>{REVIEW_LABEL[license.reviewStatus]}</Badge>
        {isBasis && <Badge tone="good">Đang là căn cứ</Badge>}
      </div>
      <dl className="facts single">
        {license.licensorName && (<><dt>Bên cấp phép</dt><dd>{license.licensorName}</dd></>)}
        {license.proofUrl && (<><dt>Bằng chứng</dt><dd><a href={license.proofUrl} target="_blank" rel="noreferrer noopener">{license.proofUrl}</a></dd></>)}
        {license.proofNote && (<><dt>Ghi chú</dt><dd className="wrap">{license.proofNote}</dd></>)}
        {license.attributionText && (<><dt>Dòng ghi nguồn</dt><dd>{license.attributionText}</dd></>)}
        <dt>Thương mại</dt>
        <dd>{license.commercialUseAllowed ? 'Cho phép' : 'Không cho phép (media bị hạn chế)'}</dd>
        <dt>Hiệu lực</dt>
        <dd>{validityText(license.validFrom, license.validUntil)}</dd>
        <dt>Khai báo bởi</dt>
        <dd>{nameOf(license.createdBy)} · {dateText(license.createdAt)}</dd>
        {license.reviewedBy && (
          <>
            <dt>Xử lý bởi</dt>
            <dd>{nameOf(license.reviewedBy)} · {dateText(license.reviewedAt)}</dd>
          </>
        )}
        {license.reviewNote && (<><dt>Lý do</dt><dd className="wrap">{license.reviewNote}</dd></>)}
      </dl>

      {canReview && (
        <div className="review-box">
          <label>
            Ghi chú (bắt buộc khi từ chối)
            <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
          </label>
          {error && <p className="field-error" role="alert">{error}</p>}
          <div className="row">
            <button type="button" className="btn btn-primary btn-small" disabled={busy} onClick={() => void decide('APPROVE')}>Duyệt giấy phép</button>
            <button type="button" className="btn btn-small" disabled={busy} onClick={() => void decide('REJECT')}>Từ chối</button>
          </div>
          <p className="muted small">Chỉ duyệt khi bạn đã kiểm tra bằng chứng. Hệ thống không tự xác nhận giấy phép.</p>
        </div>
      )}
    </li>
  );
}
