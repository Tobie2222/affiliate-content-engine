import { RULE_LABEL, qaCounts, qaIsCurrent, type ApiPost } from './content';

export function QaReportView({ post }: { post: ApiPost }) {
  const report = post.qaReport;
  if (!report) {
    return <p className="muted">Bài chưa được kiểm tra. Bấm "Kiểm tra lại" để chạy QA.</p>;
  }
  const { fail, warn } = qaCounts(report);
  const current = qaIsCurrent(post);
  const ordered = [...report.findings].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'FAIL' ? -1 : 1));

  return (
    <div className="qa">
      {!current && (
        <p className="notice notice-warn" role="status">
          Báo cáo này kiểm tra phiên bản {report.forVersion}, còn bài đang ở phiên bản {post.contentVersion}. Hãy kiểm tra lại.
        </p>
      )}
      <p className="qa-summary">
        {fail === 0 && warn === 0 && 'Không có lỗi hay cảnh báo.'}
        {fail > 0 && <strong>{fail} lỗi cần sửa</strong>}
        {fail > 0 && warn > 0 && ', '}
        {warn > 0 && <span>{warn} cảnh báo để người duyệt cân nhắc</span>}
      </p>
      {ordered.length > 0 && (
        <ul className="findings">
          {ordered.map((f, i) => (
            <li key={`${f.rule}-${i}`} data-severity={f.severity}>
              <span className="finding-tag">{f.severity === 'FAIL' ? 'Lỗi' : 'Cảnh báo'}</span>
              <div>
                <strong>{RULE_LABEL[f.rule] ?? f.rule}</strong>
                <p>{f.message}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">
        Kiểm tra lúc {new Date(report.checkedAt).toLocaleString('vi-VN')}. Độ dài khi đăng: {report.composedLength}/500 ký tự (gồm dòng công khai và link).
      </p>
    </div>
  );
}
