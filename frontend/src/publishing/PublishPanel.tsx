import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { ApiPost } from '../content/content';
import { ConfirmButton } from '../ui/ConfirmButton';
import type { Role } from '../org/OrgContext';
import {
  COMMENT_STATUS_LABEL,
  PUBLISH_STATUS_HINT,
  accountLabel,
  activeAccounts,
  commentActions,
  commentText,
  defaultScheduleInput,
  failureText,
  formatVN,
  localInputToIso,
  publishActions,
  validatePermalinkInput,
  validateScheduleInput,
  type PostPublishing,
  type SocialAccount,
} from './publishing';

/** Khối "Đăng bài" ở cột bên của trang bài viết: lên lịch, hủy lịch, thử lại và xem kết quả. */
export function PublishPanel({
  post,
  role,
  info,
  accounts,
  busy,
  onSchedule,
  onUnschedule,
  onRetry,
  onMarkPublished,
  onRetryComment,
}: {
  post: ApiPost;
  role: Role;
  info: PostPublishing | null;
  accounts: SocialAccount[];
  busy: boolean;
  onSchedule(accountId: string, scheduledForIso: string): Promise<boolean>;
  onUnschedule(): Promise<boolean>;
  onRetry(confirmNotPublished: boolean): Promise<boolean>;
  onMarkPublished(permalink: string): Promise<boolean>;
  onRetryComment(options: { confirmNotPosted?: boolean; alreadyPosted?: boolean }): Promise<boolean>;
}) {
  const jobs = info?.jobs ?? [];
  const actions = publishActions(post.status, jobs, role);
  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const latest = jobs[0] ?? null;
  const latestAccount = latest ? accountById.get(latest.socialAccountId) : undefined;

  return (
    <section className="card">
      <h2>Đăng bài</h2>
      <p className="muted small">{PUBLISH_STATUS_HINT[post.status]}</p>

      {actions.canSchedule && <ScheduleForm accounts={accounts} busy={busy} onSchedule={onSchedule} />}
      {post.status === 'APPROVED' && !actions.canSchedule && (
        <p className="muted small">Vai trò của bạn không có quyền lên lịch đăng.</p>
      )}

      {post.status === 'SCHEDULED' && latest && (
        <>
          <p>
            Đăng lúc <strong>{formatVN(latest.scheduledFor)}</strong>
            {latestAccount && <> lên {accountLabel(latestAccount)}</>}.
          </p>
          <p className="muted small">Hệ thống kiểm tra lại link và giấy phép ngay trước giờ đăng. Nếu không còn hợp lệ, bài sẽ bị chặn thay vì đăng.</p>
          {actions.canUnschedule && (
            <ConfirmButton label="Hủy lịch" confirmLabel="Xác nhận hủy lịch" disabled={busy} onConfirm={() => void onUnschedule()} />
          )}
        </>
      )}

      {post.status === 'PUBLISHED' && info?.published && (
        <PublishedResult
          published={info.published}
          account={accountById.get(info.published.socialAccountId)}
          role={role}
          busy={busy}
          onRetryComment={onRetryComment}
        />
      )}

      {post.status === 'FAILED' && latest && (
        <FailedResult
          text={failureText(latest)}
          canRetry={actions.canRetry}
          needsConfirm={actions.retryNeedsConfirm}
          busy={busy}
          onRetry={onRetry}
          markHandle={actions.canMarkPublished ? (latestAccount?.handle ?? null) : undefined}
          onMarkPublished={onMarkPublished}
        />
      )}

      {jobs.length > 0 && (
        <details className="small">
          <summary>Lịch sử đăng ({jobs.length})</summary>
          <ul className="timeline">
            {jobs.map((j) => (
              <li key={j.id}>
                {formatVN(j.scheduledFor)} · {JOB_LABEL[j.status]} · lần thử {j.attempts}
                {j.lastError && <p className="note-text">{j.lastError}</p>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

const JOB_LABEL = {
  QUEUED: 'chờ đến giờ',
  PUBLISHING: 'đang đăng',
  SUCCEEDED: 'đã đăng',
  FAILED: 'thất bại',
  CANCELLED: 'đã hủy',
} as const;

function ScheduleForm({
  accounts,
  busy,
  onSchedule,
}: {
  accounts: SocialAccount[];
  busy: boolean;
  onSchedule(accountId: string, scheduledForIso: string): Promise<boolean>;
}) {
  const usable = activeAccounts(accounts);
  const [accountId, setAccountId] = useState(usable.length === 1 ? usable[0].id : '');
  const [when, setWhen] = useState(() => defaultScheduleInput(new Date()));
  const [error, setError] = useState<string | null>(null);
  const chosen = usable.find((a) => a.id === accountId);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const problem = validateScheduleInput(when, accountId, new Date());
    setError(problem);
    const iso = localInputToIso(when);
    if (problem || !iso) {
      return;
    }
    await onSchedule(accountId, iso);
  }

  if (usable.length === 0) {
    return (
      <p className="notice notice-warn">
        Chưa có tài khoản Threads đang hoạt động. <Link to="/accounts">Kết nối tài khoản</Link> trước khi lên lịch.
      </p>
    );
  }

  return (
    <form className="form" onSubmit={(e) => void submit(e)}>
      <label>
        Tài khoản Threads
        <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          <option value="">Chọn tài khoản…</option>
          {usable.map((a) => (
            <option key={a.id} value={a.id}>{accountLabel(a)}</option>
          ))}
        </select>
      </label>
      <label>
        Giờ đăng (giờ Việt Nam)
        <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
      </label>
      {chosen?.mode === 'MOCK' && (
        <p className="notice notice-warn" role="status">
          Đây là tài khoản giả lập: bài sẽ không được đăng lên Threads thật.
        </p>
      )}
      {error && <p className="field-error" role="alert">{error}</p>}
      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? 'Đang lên lịch…' : 'Lên lịch đăng'}
      </button>
    </form>
  );
}

function PublishedResult({
  published,
  account,
  role,
  busy,
  onRetryComment,
}: {
  published: NonNullable<PostPublishing['published']>;
  account?: SocialAccount;
  role: Role;
  busy: boolean;
  onRetryComment(options: { confirmNotPosted?: boolean; alreadyPosted?: boolean }): Promise<boolean>;
}) {
  const mock = account?.mode === 'MOCK';
  const [confirmed, setConfirmed] = useState(false);
  const comment = commentActions(published, role);
  return (
    <div>
      <p>
        Đã đăng lúc <strong>{formatVN(published.publishedAt)}</strong>
        {account && <> lên {accountLabel(account)}</>}.
      </p>
      {mock ? (
        <p className="muted small">Đăng giả lập: không có bài thật trên Threads.</p>
      ) : (
        published.permalink && <p className="small"><a href={published.permalink} target="_blank" rel="noreferrer noopener">Mở bài trên Threads</a></p>
      )}
      {published.commentStatus !== 'NONE' && (
        <div>
          <p className={published.commentStatus === 'FAILED' ? 'notice notice-error' : 'muted small'} role={published.commentStatus === 'FAILED' ? 'alert' : undefined}>
            <strong>{COMMENT_STATUS_LABEL[published.commentStatus]}.</strong> {commentText(published)}
          </p>
          {comment.canRetry && (
            <div className="form">
              {comment.needsConfirm && (
                <label className="radio">
                  <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                  Tôi đã kiểm tra trên Threads và comment này chưa có
                </label>
              )}
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || (comment.needsConfirm && !confirmed)}
                onClick={() => void onRetryComment(comment.needsConfirm ? { confirmNotPosted: true } : {})}
              >
                Đăng lại comment
              </button>
              {comment.needsConfirm && (
                <ConfirmButton
                  label="Comment thực ra đã có"
                  confirmLabel="Xác nhận comment đã có"
                  disabled={busy}
                  onConfirm={() => void onRetryComment({ alreadyPosted: true })}
                />
              )}
              <p className="muted small">Chỉ đăng lại comment, bài chính không bị đăng lại. Link được kiểm tra lại trước khi đăng.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FailedResult({
  text,
  canRetry,
  needsConfirm,
  busy,
  onRetry,
  markHandle,
  onMarkPublished,
}: {
  text: string;
  canRetry: boolean;
  needsConfirm: boolean;
  busy: boolean;
  onRetry(confirmNotPublished: boolean): Promise<boolean>;
  /** undefined = không có quyền ghi nhận; null = có quyền nhưng không rõ tài khoản. */
  markHandle: string | null | undefined;
  onMarkPublished(permalink: string): Promise<boolean>;
}) {
  const [confirmed, setConfirmed] = useState(false);
  return (
    <div>
      <p className="notice notice-error" role="alert">{text}</p>
      {canRetry && (
        <div className="form">
          {needsConfirm && (
            <label className="radio">
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              Tôi đã kiểm tra trên Threads và bài chưa được đăng
            </label>
          )}
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || (needsConfirm && !confirmed)}
            onClick={() => void onRetry(needsConfirm && confirmed)}
          >
            Thử đăng lại
          </button>
          <p className="muted small">Hệ thống kiểm tra lại link và giấy phép trước khi đăng lại.</p>
        </div>
      )}
      {markHandle !== undefined && <MarkPublishedForm handle={markHandle} busy={busy} onMarkPublished={onMarkPublished} />}
    </div>
  );
}

/** Dành cho trường hợp hệ thống báo lỗi nhưng bài thực tế đã lên Threads: ghi nhận để không đăng trùng. */
function MarkPublishedForm({
  handle,
  busy,
  onMarkPublished,
}: {
  handle: string | null;
  busy: boolean;
  onMarkPublished(permalink: string): Promise<boolean>;
}) {
  const [permalink, setPermalink] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const problem = validatePermalinkInput(permalink, handle);
    setError(problem);
    if (!problem) {
      await onMarkPublished(permalink.trim());
    }
  }

  return (
    <details className="small">
      <summary>Bài thực ra đã có trên Threads</summary>
      <form className="form" onSubmit={(e) => void submit(e)}>
        <label>
          Link bài trên Threads
          <input type="url" value={permalink} placeholder="https://www.threads.net/@tên/post/mã" onChange={(e) => setPermalink(e.target.value)} />
        </label>
        <label className="radio">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          Tôi đã mở Threads và thấy bài này đang hiển thị
        </label>
        {error && <p className="field-error" role="alert">{error}</p>}
        <button type="submit" className="btn" disabled={busy || !confirmed || permalink.trim() === ''}>
          Ghi nhận đã đăng
        </button>
        <p className="muted small">Bài sẽ chuyển sang "Đã đăng" và không thể đăng lại, tránh đăng trùng.</p>
      </form>
    </details>
  );
}
