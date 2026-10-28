import { useState, type FormEvent } from 'react';
import { api } from '../api/client';
import {
  EMPTY_PRODUCT_FORM,
  buildProductPayload,
  validateProductForm,
  type ApiProduct,
  type ProductForm as FormValues,
  type ProductFormErrors,
} from './products';

export function ProductFormPanel({
  orgId,
  onDone,
  onCancel,
}: {
  orgId: string;
  onDone(product: ApiProduct): void;
  onCancel(): void;
}) {
  const [form, setForm] = useState<FormValues>(EMPTY_PRODUCT_FORM);
  const [errors, setErrors] = useState<ProductFormErrors>({});
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const set = (key: keyof FormValues) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const found = validateProductForm(form);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      return;
    }
    setBusy(true);
    setServerError(null);
    try {
      const product = await api<ApiProduct>(`/organizations/${orgId}/products`, {
        method: 'POST',
        body: buildProductPayload(form),
      });
      onDone(product);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Không lưu được sản phẩm.');
    } finally {
      setBusy(false);
    }
  }

  const field = (key: keyof FormValues, label: string, opts: { hint?: string; placeholder?: string; wide?: boolean } = {}) => (
    <label className={opts.wide ? 'span-2' : undefined}>
      {label}
      <input value={form[key]} onChange={(e) => set(key)(e.target.value)} placeholder={opts.placeholder} aria-invalid={errors[key] ? true : undefined} />
      {opts.hint && !errors[key] && <small className="muted">{opts.hint}</small>}
      {errors[key] && <small className="field-error">{errors[key]}</small>}
    </label>
  );

  return (
    <section className="card composer" aria-label="Thêm sản phẩm">
      <h2>Thêm sản phẩm</h2>
      <form className="form" onSubmit={(e) => void submit(e)} noValidate>
        <div className="grid-2">
          {field('externalProductId', 'Mã sản phẩm', { placeholder: 'SP001', hint: 'Cùng mã sẽ cập nhật sản phẩm đã có.' })}
          {field('category', 'Danh mục')}
        </div>
        {field('name', 'Tên sản phẩm')}
        {field('productUrl', 'Link sản phẩm', { placeholder: 'https://shopee.vn/product/123/456' })}
        <label>
          Mô tả
          <textarea rows={3} value={form.description} onChange={(e) => set('description')(e.target.value)} maxLength={5000} />
        </label>
        {field('imageUrl', 'Link ảnh sản phẩm')}
        <div className="grid-3">
          {field('price', 'Giá', { hint: 'Để trống nếu chưa biết.' })}
          {field('currency', 'Tiền tệ')}
          {field('commissionRate', 'Hoa hồng (%)', { hint: 'Để trống nếu chưa biết.' })}
        </div>
        {serverError && <p className="notice notice-error" role="alert">{serverError}</p>}
        <div className="row">
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu sản phẩm'}</button>
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>Hủy</button>
        </div>
      </form>
    </section>
  );
}
