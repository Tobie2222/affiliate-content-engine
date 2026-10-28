import { useState } from 'react';
import { api } from '../api/client';
import { CSV_TEMPLATE, MAX_CSV_CHARS, summarizeBulk, type ImportResult } from './products';

export function CsvImportPanel({
  orgId,
  onImported,
  onCancel,
}: {
  orgId: string;
  onImported(message: string): void;
  onCancel(): void;
}) {
  const [csv, setCsv] = useState('');
  const [checked, setChecked] = useState<{ text: string; result: ImportResult } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tooLong = csv.length > MAX_CSV_CHARS;
  // Kết quả kiểm tra chỉ có hiệu lực khi nội dung CSV chưa thay đổi kể từ lúc kiểm tra.
  const ready = checked !== null && checked.text === csv ? checked.result : null;

  async function run(dryRun: boolean) {
    setBusy(true);
    setError(null);
    try {
      const result = await api<ImportResult>(`/organizations/${orgId}/products/import`, {
        method: 'POST',
        body: { csv, dryRun },
      });
      if (dryRun) {
        setChecked({ text: csv, result });
      } else {
        onImported(summarizeBulk(result));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không nhập được.');
    } finally {
      setBusy(false);
    }
  }

  async function pickFile(file: File | undefined) {
    if (!file) {
      return;
    }
    try {
      setCsv(await file.text());
      setChecked(null);
      setError(null);
    } catch {
      setError('Không đọc được tệp này.');
    }
  }

  return (
    <section className="card composer" aria-label="Nhập CSV">
      <h2>Nhập sản phẩm từ CSV</h2>
      <p className="muted small">
        Cột bắt buộc: external_product_id, name, product_url. Cột tùy chọn: description, category, image_url, price, currency, commission_rate.
        Ô giá hoặc hoa hồng để trống nghĩa là chưa biết.
      </p>
      <div className="form">
        <div className="row">
          <label className="file-pick">
            <span className="btn btn-small">Chọn tệp .csv</span>
            <input type="file" accept=".csv,text/csv" onChange={(e) => void pickFile(e.target.files?.[0])} />
          </label>
          <button type="button" className="btn btn-small" onClick={() => { setCsv(CSV_TEMPLATE); setChecked(null); }}>
            Dùng dòng mẫu
          </button>
        </div>
        <label>
          Nội dung CSV
          <textarea rows={8} value={csv} onChange={(e) => { setCsv(e.target.value); setChecked(null); }} spellCheck={false} className="mono" />
          <small className={tooLong ? 'field-error' : 'muted'}>
            {csv.length.toLocaleString('vi-VN')}/{MAX_CSV_CHARS.toLocaleString('vi-VN')} ký tự, tối đa 500 dòng mỗi lần.
          </small>
        </label>

        {error && <p className="notice notice-error" role="alert">{error}</p>}

        {checked && (
          <div className="import-result" role="status">
            <p><strong>{summarizeBulk(checked.result)}</strong></p>
            {checked.result.ignoredColumns.length > 0 && (
              <p className="muted small">Cột không dùng, sẽ bị bỏ qua: {checked.result.ignoredColumns.join(', ')}.</p>
            )}
            {checked.result.errors.length > 0 && (
              <ul className="findings">
                {checked.result.errors.slice(0, 20).map((issue) => (
                  <li key={issue.line} data-severity="FAIL">
                    <span className="finding-tag">Dòng {issue.line}</span>
                    <div>{issue.errors.join(' ')}</div>
                  </li>
                ))}
              </ul>
            )}
            {checked.result.errors.length > 20 && <p className="muted small">Chỉ hiện 20 lỗi đầu tiên.</p>}
          </div>
        )}

        <div className="row">
          <button type="button" className="btn" disabled={busy || csv.trim() === '' || tooLong} onClick={() => void run(true)}>
            {busy ? 'Đang xử lý…' : 'Kiểm tra trước'}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || ready === null || ready.valid === 0}
            onClick={() => void run(false)}
          >
            Nhập {ready !== null ? `${ready.valid} dòng hợp lệ` : ''}
          </button>
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>Đóng</button>
        </div>
        {ready === null && csv.trim() !== '' && <p className="muted small">Hãy bấm "Kiểm tra trước" để xem lỗi rồi mới nhập. Việc kiểm tra không ghi gì vào hệ thống.</p>}
      </div>
    </section>
  );
}
