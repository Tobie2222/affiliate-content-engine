import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { useApi } from '../api/useApi';
import { useAuth } from '../auth/AuthContext';
import { linkOptionLabel, mediaOptionLabel, type LinkItem, type MediaItem, type ProductItem } from '../content/catalog';
import { StatusBadge, VerdictBadge } from '../content/Badges';
import {
  DECISION_LABEL,
  composePreview,
  countChars,
  originLabel,
  postActions,
  qaVerdict,
  validateReview,
  type ApiPost,
  type Page,
  type PostDetail,
  type ReviewDecision,
} from '../content/content';
import { LengthMeter } from '../content/LengthMeter';
import { QaReportView } from '../content/QaReportView';
import { useOrg } from '../org/OrgContext';

interface Member {
  userId: string;
  displayName: string;
  email: string;
}

const DECISION_OPTIONS: ReadonlyArray<{ value: ReviewDecision; label: string }> = [
  { value: 'APPROVE', label: 'Duyệt' },
  { value: 'REQUEST_CHANGES', label: 'Yêu cầu sửa' },
  { value: 'REJECT', label: 'Từ chối' },
];

export function PostDetailPage() {
  const { postId } = useParams();
  const { current } = useOrg();
  const { user } = useAuth();
  const orgId = current?.id ?? null;

  const detail = useApi<PostDetail>(orgId && postId ? `/organizations/${orgId}/content/posts/${postId}` : null);
  const settings = useApi<{ separationOfDuties: boolean }>(orgId ? `/organizations/${orgId}/settings` : null);
  const members = useApi<Member[]>(orgId ? `/organizations/${orgId}/members` : null);
  const product = useApi<ProductItem>(
    orgId && detail.data ? `/organizations/${orgId}/products/${detail.data.post.productId}` : null,
  );

  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const nameOf = useMemo(() => {
    const map = new Map<string, string>();
    (members.data ?? []).forEach((m) => map.set(m.userId, m.displayName || m.email));
    return (id: string | null, source?: 'HUMAN' | 'AI'): string => {
      if (id === null) {
        return source === 'AI' ? 'AI' : 'Không rõ';
      }
      if (id === user?.id) {
        return 'Bạn';
      }
      return map.get(id) ?? 'Thành viên khác';
    };
  }, [members.data, user?.id]);

  if (!current || !orgId || !postId) {
    return null;
  }

  if (detail.error && !detail.data) {
    return (
      <div>
        <p><Link to="/content">← Về danh sách bài</Link></p>
        <p className="notice notice-error" role="alert">
          {detail.status === 404 || detail.status === 403 ? 'Không tìm thấy bài này trong tổ chức hiện tại.' : detail.error}
        </p>
        <button type="button" className="btn" onClick={() => void detail.reload()}>Thử lại</button>
      </div>
    );
  }
  if (!detail.data) {
    return <p className="muted">Đang tải bài viết…</p>;
  }

  const { post, versions, approvals } = detail.data;
  const sod = settings.data?.separationOfDuties ?? true;
  const actions = postActions(post, { role: current.role, userId: user?.id ?? '', separationOfDuties: sod });
  const base = `/organizations/${orgId}/content/posts/${post.id}`;
  const verdict = qaVerdict(post);

  /** Chạy một thao tác rồi tải lại bài. Lỗi cũng tải lại: máy chủ có thể đã chạy lại QA hoặc bài đã đổi. */
  async function run(work: () => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    setActionError(null);
    try {
      await work();
      await detail.reload();
      return true;
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Thao tác thất bại.');
      await detail.reload();
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="back"><Link to="/content">← Về danh sách bài</Link></p>
      <header className="page-head">
        <div>
          <h1>Bài viết</h1>
          <p className="muted">
            {product.data?.name ?? 'Sản phẩm'} · {originLabel(post)} · Phiên bản {post.contentVersion}
          </p>
        </div>
        <div className="row">
          <StatusBadge status={post.status} />
          <VerdictBadge verdict={verdict} />
        </div>
      </header>

      {post.llmProvider === 'mock' && post.generatedBy === 'AI' && (
        <p className="notice notice-warn" role="status">
          Đây là bản nháp mẫu (giả lập). Hãy viết lại nội dung thật và bỏ nhãn [MẪU], nếu không QA sẽ không cho gửi duyệt.
        </p>
      )}
      {post.blockedReason && <p className="notice notice-error">Bị chặn: {post.blockedReason}</p>}
      {actionError && <p className="notice notice-error" role="alert">{actionError}</p>}

      <div className="detail-grid">
        <div className="detail-main">
          <ContentCard
            key={post.id}
            orgId={orgId}
            post={post}
            canEdit={actions.canEdit}
            editResetsApproval={actions.editResetsApproval}
            busy={busy}
            onSave={(patch) => run(() => api(base, { method: 'PATCH', body: patch }))}
          />

          <section className="card">
            <div className="card-head">
              <h2>Kiểm tra QA</h2>
              {current.role !== 'ANALYST' && (
                <button type="button" className="btn btn-small" disabled={busy} onClick={() => void run(() => api(`${base}/qa`, { method: 'POST' }))}>
                  Kiểm tra lại
                </button>
              )}
            </div>
            <QaReportView post={post} />
          </section>

          <section className="card">
            <h2>Lịch sử</h2>
            <ul className="timeline">
              {approvals.map((a) => (
                <li key={a.id}>
                  <strong>{DECISION_LABEL[a.decision]}</strong> phiên bản {a.contentVersion} bởi {nameOf(a.reviewerId)}
                  <span className="muted small"> · {new Date(a.createdAt).toLocaleString('vi-VN')}</span>
                  {a.note && <p className="note-text">{a.note}</p>}
                </li>
              ))}
              {versions.map((v) => (
                <li key={v.id}>
                  Phiên bản {v.version} {v.source === 'AI' ? 'do AI đề xuất' : `do ${nameOf(v.editedBy)} soạn`}
                  <span className="muted small"> · {new Date(v.createdAt).toLocaleString('vi-VN')}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <aside className="detail-side">
          {(actions.canSubmit || actions.canWithdraw) && (
            <section className="card">
              <h2>Gửi duyệt</h2>
              {actions.canSubmit && (
                <>
                  <p className="muted small">Hệ thống chạy QA lại trước khi gửi. Bài còn lỗi sẽ không gửi được.</p>
                  {verdict === 'fail' && (
                    <p className="field-error small">Bài còn lỗi QA. Hãy sửa các lỗi ở mục "Kiểm tra QA" trước khi gửi.</p>
                  )}
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy || verdict === 'fail'}
                    onClick={() => void run(() => api(`${base}/submit`, { method: 'POST' }))}
                  >
                    Gửi duyệt
                  </button>
                </>
              )}
              {actions.canWithdraw && (
                <>
                  <p className="muted small">Bài đang chờ người duyệt. Rút lại để sửa tiếp.</p>
                  <button type="button" className="btn" disabled={busy} onClick={() => void run(() => api(`${base}/withdraw`, { method: 'POST' }))}>
                    Rút lại về bản nháp
                  </button>
                </>
              )}
            </section>
          )}

          {actions.canReview && (
            <ReviewPanel
              version={post.contentVersion}
              busy={busy}
              approveBlockedReason={actions.approveBlockedReason}
              onSubmit={(decision, note) =>
                run(() => api(`${base}/review`, { method: 'POST', body: { decision, version: post.contentVersion, ...(note.trim() ? { note: note.trim() } : {}) } }))
              }
            />
          )}

          {!actions.canSubmit && !actions.canWithdraw && !actions.canReview && (
            <section className="card">
              <h2>Trạng thái</h2>
              <p className="muted small">{statusHint(post)}</p>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

function statusHint(post: ApiPost): string {
  switch (post.status) {
    case 'PENDING_APPROVAL':
      return 'Bài đang chờ người có quyền duyệt xem xét.';
    case 'APPROVED':
      return 'Bài đã được duyệt. Việc lên lịch và đăng sẽ có ở giai đoạn sau.';
    case 'REJECTED':
      return 'Bài đã bị từ chối và không đi tiếp được. Bạn có thể tạo bài mới.';
    case 'CHANGES_REQUESTED':
      return 'Người duyệt yêu cầu sửa. Biên tập viên sửa nội dung rồi gửi duyệt lại.';
    default:
      return 'Bạn không có thao tác nào với bài này ở trạng thái hiện tại.';
  }
}

function ContentCard({
  orgId,
  post,
  canEdit,
  editResetsApproval,
  busy,
  onSave,
}: {
  orgId: string;
  post: ApiPost;
  canEdit: boolean;
  editResetsApproval: boolean;
  busy: boolean;
  onSave(patch: {
    expectedVersion: number;
    body: string;
    disclosureText: string;
    affiliateLinkId: string;
    mediaAssetId: string | null;
  }): Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  // Phiên bản lúc bắt đầu sửa. Gửi đúng phiên bản này để nếu có người sửa trước, máy chủ báo xung đột
  // thay vì ghi đè lên thay đổi của họ.
  const [baseVersion, setBaseVersion] = useState(post.contentVersion);
  const [body, setBody] = useState(post.body);
  const [disclosure, setDisclosure] = useState(post.disclosureText);
  const [linkId, setLinkId] = useState(post.affiliateLinkId);
  const [mediaId, setMediaId] = useState(post.mediaAssetId ?? '');

  const links = useApi<LinkItem[]>(editing ? `/organizations/${orgId}/products/${post.productId}/links` : null);
  const media = useApi<Page<MediaItem>>(editing ? `/organizations/${orgId}/media/assets?limit=100` : null);
  const selectedLink = links.data?.find((l) => l.id === linkId) ?? null;

  // Nội dung hiển thị khi xem: ưu tiên bản ghép từ báo cáo QA đúng phiên bản; nếu không có thì ghép tạm để xem.
  const shown =
    post.qaReport && post.qaReport.forVersion === post.contentVersion
      ? post.qaReport.composedText
      : composePreview(post.body, post.disclosureText, null);

  useEffect(() => {
    if (!editing) {
      setBody(post.body);
      setDisclosure(post.disclosureText);
      setLinkId(post.affiliateLinkId);
      setMediaId(post.mediaAssetId ?? '');
    }
  }, [editing, post]);

  async function save(e: FormEvent) {
    e.preventDefault();
    const ok = await onSave({
      expectedVersion: baseVersion,
      body: body.trim(),
      disclosureText: disclosure.trim(),
      affiliateLinkId: linkId,
      mediaAssetId: mediaId === '' ? null : mediaId,
    });
    if (ok) {
      setEditing(false);
    }
  }

  if (!editing) {
    return (
      <section className="card">
        <div className="card-head">
          <h2>Nội dung khi đăng</h2>
          {canEdit && (
            <button type="button" className="btn btn-small" onClick={() => { setBaseVersion(post.contentVersion); setEditing(true); }} disabled={busy}>
              Sửa
            </button>
          )}
        </div>
        <pre className="post-text">{shown}</pre>
        <LengthMeter chars={countChars(shown)} />
        {post.mediaAssetId && <p className="muted small">Có gắn media. Giấy phép được kiểm tra lại mỗi lần chạy QA.</p>}
      </section>
    );
  }

  const preview = composePreview(body, disclosure, selectedLink?.affiliateUrl ?? null);
  return (
    <section className="card">
      <h2>Sửa nội dung</h2>
      {post.contentVersion !== baseVersion && (
        <p className="notice notice-error" role="alert">
          Bài đã được người khác sửa (phiên bản {post.contentVersion}, bạn đang sửa từ phiên bản {baseVersion}). Hãy sao chép phần bạn đã gõ, bấm Hủy rồi sửa lại trên bản mới.
        </p>
      )}
      {editResetsApproval && (
        <p className="notice notice-warn" role="status">
          Bài đang ở trạng thái "{post.status === 'APPROVED' ? 'đã duyệt' : 'chờ duyệt'}". Lưu thay đổi sẽ đưa bài về bản nháp và cần duyệt lại.
        </p>
      )}
      <form className="form" onSubmit={(e) => void save(e)}>
        <label>
          Nội dung bài
          <textarea rows={7} value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} />
        </label>
        <label>
          Dòng công khai hoa hồng
          <input value={disclosure} onChange={(e) => setDisclosure(e.target.value)} maxLength={300} />
        </label>
        <label>
          Link affiliate
          <select value={linkId} onChange={(e) => setLinkId(e.target.value)}>
            {!links.data && <option value={post.affiliateLinkId}>Đang tải…</option>}
            {(links.data ?? []).map((l) => (
              <option key={l.id} value={l.id}>{linkOptionLabel(l)}</option>
            ))}
          </select>
        </label>
        <label>
          Media
          <select value={mediaId} onChange={(e) => setMediaId(e.target.value)}>
            <option value="">Không dùng media</option>
            {(media.data?.items ?? []).map((m) => (
              <option key={m.id} value={m.id}>{mediaOptionLabel(m)}</option>
            ))}
            {mediaId !== '' && !(media.data?.items ?? []).some((m) => m.id === mediaId) && (
              <option value={mediaId}>Media hiện tại</option>
            )}
          </select>
        </label>
        <LengthMeter chars={countChars(preview)} />
        <div className="row">
          <button type="submit" className="btn btn-primary" disabled={busy || body.trim() === '' || post.contentVersion !== baseVersion}>
            {busy ? 'Đang lưu…' : 'Lưu thay đổi'}
          </button>
          <button type="button" className="btn" onClick={() => setEditing(false)} disabled={busy}>Hủy</button>
        </div>
      </form>
    </section>
  );
}

function ReviewPanel({
  version,
  busy,
  approveBlockedReason,
  onSubmit,
}: {
  version: number;
  busy: boolean;
  approveBlockedReason: string | null;
  onSubmit(decision: ReviewDecision, note: string): Promise<boolean>;
}) {
  const [decision, setDecision] = useState<ReviewDecision>(approveBlockedReason ? 'REQUEST_CHANGES' : 'APPROVE');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const problem = validateReview(decision, note);
    setError(problem);
    if (problem) {
      return;
    }
    await onSubmit(decision, note);
  }

  return (
    <section className="card">
      <h2>Duyệt bài</h2>
      <p className="muted small">Bạn đang duyệt phiên bản {version}. Hệ thống kiểm tra lại link, giấy phép và giá ngay khi bạn duyệt.</p>
      <form className="form" onSubmit={(e) => void submit(e)}>
        <fieldset className="choice">
          <legend className="sr-only">Quyết định</legend>
          {DECISION_OPTIONS.map((opt) => {
            const disabled = opt.value === 'APPROVE' && approveBlockedReason !== null;
            return (
              <label key={opt.value} className="radio" data-disabled={disabled}>
                <input
                  type="radio"
                  name="decision"
                  value={opt.value}
                  checked={decision === opt.value}
                  disabled={disabled}
                  onChange={() => setDecision(opt.value)}
                />
                {opt.label}
              </label>
            );
          })}
        </fieldset>
        {approveBlockedReason && <p className="notice notice-warn">{approveBlockedReason}</p>}
        <label>
          Ghi chú {decision === 'APPROVE' ? '(không bắt buộc)' : '(bắt buộc)'}
          <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
        </label>
        {error && <p className="field-error" role="alert">{error}</p>}
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Đang gửi…' : 'Xác nhận'}
        </button>
      </form>
    </section>
  );
}

