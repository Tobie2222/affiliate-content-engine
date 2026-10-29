import { useState, type FormEvent } from 'react';
import { api } from '../api/client';
import { EMPTY_METRIC_FORM, METRIC_KEYS, METRIC_LABEL, buildMetricPayload, type MetricForm } from './analytics';

/** Nhập số liệu bạn thấy trên Threads cho một bài. Ô trống = chưa biết. */
export function MetricsForm({
  orgId,
  publishedPostId,
  onDone,
  onCancel,
}: {
  orgId: string;
  publishedPostId: string;
  onDone(message: string): void;
  onCancel(): void;
}) {
  const [form, setForm] = useState<MetricForm>(EMPTY_METRIC_FORM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const built = buildMetricPayload(form);
    if (!built.ok) {
      setError(built.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ warnings: string[] }>(`/organizations/${orgId}/analytics/published/${publishedPostId}/metrics`, {
        method: 'POST',
        body: built.payload,
      });
      onDone(['Đã ghi nhận số liệu.', ...result.warnings].join(' '));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không lưu được số liệu.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form metrics-form" onSubmit={(e) => void submit(e)}>
      <p className="muted small">Nhập số bạn thấy trên Threads lúc này. Ô để trống nghĩa là chưa biết, không phải 0.</p>
      <div className="metrics-inputs">
        {METRIC_KEYS.map((key) => (
          <label key={key}>
            {METRIC_LABEL[key]}
            <input inputMode="numeric" value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
          </label>
        ))}
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="row">
        <button type="submit" className="btn btn-primary btn-small" disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu số liệu'}</button>
        <button type="button" className="btn btn-small" onClick={onCancel} disabled={busy}>Hủy</button>
      </div>
    </form>
  );
}
