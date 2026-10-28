import { useState, type FormEvent } from 'react';
import { api } from '../api/client';
import {
  EMPTY_ASSET_FORM,
  buildAssetPayload,
  validateAssetForm,
  type ApiAsset,
  type AssetForm,
  type AssetFormErrors,
  type MediaType,
} from './media';

export function AssetFormPanel({
  orgId,
  onDone,
  onCancel,
}: {
  orgId: string;
  onDone(asset: ApiAsset): void;
  onCancel(): void;
}) {
  const [form, setForm] = useState<AssetForm>(EMPTY_ASSET_FORM);
  const [errors, setErrors] = useState<AssetFormErrors>({});
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const found = validateAssetForm(form);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      return;
    }
    setBusy(true);
    setServerError(null);
    try {
      onDone(await api<ApiAsset>(`/organizations/${orgId}/media/assets`, { method: 'POST', body: buildAssetPayload(form) }));
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Không lưu được media.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card composer" aria-label="Thêm media">
      <h2>Thêm media</h2>
      <p className="muted small">
        Hệ thống chưa lưu file. Bạn khai báo địa chỉ https nơi file đang được đặt, rồi khai báo giấy phép ở bước sau.
        Media chỉ dùng được trong bài khi giấy phép đã được người có quyền duyệt xác nhận.
      </p>
      <form className="form" onSubmit={(e) => void submit(e)} noValidate>
        <div className="grid-2">
          <label>
            Loại
            <select value={form.mediaType} onChange={(e) => setForm({ ...form, mediaType: e.target.value as MediaType })}>
              <option value="IMAGE">Ảnh</option>
              <option value="VIDEO">Video</option>
            </select>
          </label>
          <label>
            Tên
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={200} aria-invalid={errors.title ? true : undefined} />
            {errors.title && <small className="field-error">{errors.title}</small>}
          </label>
        </div>
        <label>
          Địa chỉ file
          <input
            value={form.sourceUrl}
            onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })}
            placeholder="https://cdn.example.com/anh/binh-giu-nhiet.jpg"
            maxLength={2048}
            aria-invalid={errors.sourceUrl ? true : undefined}
          />
          {errors.sourceUrl && <small className="field-error">{errors.sourceUrl}</small>}
        </label>
        <label>
          Mô tả (không bắt buộc)
          <textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={2000} />
        </label>
        {serverError && <p className="notice notice-error" role="alert">{serverError}</p>}
        <div className="row">
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu media'}</button>
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>Hủy</button>
        </div>
      </form>
    </section>
  );
}
