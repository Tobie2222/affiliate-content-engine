import { useState, type FormEvent } from 'react';
import { useOrg } from '../org/OrgContext';

export function CreateOrgForm({ onDone, title }: { onDone?: () => void; title: string }) {
  const { create } = useOrg();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await create(name.trim());
      setName('');
      onDone?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không tạo được tổ chức.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={(e) => void submit(e)}>
      <h2>{title}</h2>
      <label>
        Tên tổ chức
        <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={100} placeholder="Ví dụ: Cửa hàng Bếp Nhà" />
      </label>
      {error && <p className="notice notice-error" role="alert">{error}</p>}
      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? 'Đang tạo…' : 'Tạo tổ chức'}
      </button>
    </form>
  );
}
