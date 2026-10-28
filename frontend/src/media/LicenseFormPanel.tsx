import { useState, type FormEvent } from 'react';
import { api } from '../api/client';
import {
  EMPTY_LICENSE_FORM,
  LICENSE_TYPES,
  LICENSE_TYPE_LABEL,
  buildLicensePayload,
  licenseNeeds,
  validateLicenseForm,
  type LicenseForm,
  type LicenseFormErrors,
  type LicenseType,
  type Need,
} from './media';

const NEED_HINT: Record<Need, string> = { required: ' (bắt buộc)', optional: ' (không bắt buộc)', either: '' };

export function LicenseFormPanel({
  orgId,
  assetId,
  onDone,
  onCancel,
}: {
  orgId: string;
  assetId: string;
  onDone(): void;
  onCancel(): void;
}) {
  const [form, setForm] = useState<LicenseForm>(EMPTY_LICENSE_FORM);
  const [errors, setErrors] = useState<LicenseFormErrors>({});
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const needs = licenseNeeds(form.licenseType);

  const set = <K extends keyof LicenseForm>(key: K, value: LicenseForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const found = validateLicenseForm(form, new Date());
    setErrors(found);
    if (Object.keys(found).length > 0) {
      return;
    }
    setBusy(true);
    setServerError(null);
    try {
      await api(`/organizations/${orgId}/media/assets/${assetId}/licenses`, { method: 'POST', body: buildLicensePayload(form) });
      onDone();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Không lưu được giấy phép.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-label="Khai báo giấy phép">
      <h2>Khai báo giấy phép</h2>
      <p className="muted small">
        Bạn khai báo, sau đó một người có quyền duyệt sẽ xác nhận. Khai sai hoặc thiếu bằng chứng sẽ bị từ chối.
      </p>
      <form className="form" onSubmit={(e) => void submit(e)} noValidate>
        <label>
          Loại giấy phép
          <select value={form.licenseType} onChange={(e) => set('licenseType', e.target.value as LicenseType)}>
            {LICENSE_TYPES.map((t) => (
              <option key={t} value={t}>{LICENSE_TYPE_LABEL[t]}</option>
            ))}
          </select>
        </label>
        <label>
          Tên tác giả / bên cấp phép{NEED_HINT[needs.licensorName]}
          <input value={form.licensorName} onChange={(e) => set('licensorName', e.target.value)} maxLength={200} aria-invalid={errors.licensorName ? true : undefined} />
          {errors.licensorName && <small className="field-error">{errors.licensorName}</small>}
        </label>
        <label>
          Link bằng chứng{needs.proofUrl === 'either' ? ' (cần link hoặc ghi chú)' : NEED_HINT[needs.proofUrl]}
          <input value={form.proofUrl} onChange={(e) => set('proofUrl', e.target.value)} placeholder="https://" maxLength={2048} aria-invalid={errors.proofUrl ? true : undefined} />
          {errors.proofUrl && <small className="field-error">{errors.proofUrl}</small>}
        </label>
        <label>
          Ghi chú bằng chứng{needs.proofNote === 'either' ? ' (cần link hoặc ghi chú)' : NEED_HINT[needs.proofNote]}
          <textarea rows={3} value={form.proofNote} onChange={(e) => set('proofNote', e.target.value)} maxLength={2000} aria-invalid={errors.proofNote ? true : undefined} />
          <small className="muted">Ví dụ: cách bạn tạo ra media, số hóa đơn, mã hợp đồng.</small>
          {errors.proofNote && <small className="field-error">{errors.proofNote}</small>}
        </label>
        {(needs.attributionText === 'required' || form.attributionText !== '') && (
          <label>
            Dòng ghi nguồn sẽ kèm khi đăng{NEED_HINT[needs.attributionText]}
            <input value={form.attributionText} onChange={(e) => set('attributionText', e.target.value)} maxLength={500} aria-invalid={errors.attributionText ? true : undefined} />
            <small className="muted">QA sẽ yêu cầu bài chứa nguyên văn dòng này.</small>
            {errors.attributionText && <small className="field-error">{errors.attributionText}</small>}
          </label>
        )}
        <label className="check">
          <input type="checkbox" checked={form.commercialUseAllowed} onChange={(e) => set('commercialUseAllowed', e.target.checked)} />
          <span>
            <strong>Giấy phép cho phép dùng thương mại</strong>
            <small className="muted">Nội dung affiliate là mục đích thương mại. Bỏ chọn nếu giấy phép không cho phép, media sẽ bị hạn chế.</small>
          </span>
        </label>
        <div className="grid-2">
          <label>
            Có hiệu lực từ (không bắt buộc)
            <input type="date" value={form.validFrom} onChange={(e) => set('validFrom', e.target.value)} aria-invalid={errors.validFrom ? true : undefined} />
            {errors.validFrom && <small className="field-error">{errors.validFrom}</small>}
          </label>
          <label>
            Hết hạn (bỏ trống nếu không hết hạn)
            <input type="date" value={form.validUntil} onChange={(e) => set('validUntil', e.target.value)} aria-invalid={errors.validUntil ? true : undefined} />
            {errors.validUntil && <small className="field-error">{errors.validUntil}</small>}
          </label>
        </div>
        <p className="muted small">Ngày được hiểu theo giờ Việt Nam (UTC+7); ngày hết hạn tính đến hết ngày đó.</p>
        {serverError && <p className="notice notice-error" role="alert">{serverError}</p>}
        <div className="row">
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Đang lưu…' : 'Gửi khai báo'}</button>
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>Hủy</button>
        </div>
      </form>
    </section>
  );
}
