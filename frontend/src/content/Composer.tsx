import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ApiError, api } from '../api/client';
import { useApi } from '../api/useApi';
import {
  linkOptionLabel,
  mediaOptionLabel,
  pickDefaultLink,
  type LinkItem,
  type MediaItem,
  type ProductItem,
} from './catalog';
import { DEFAULT_DISCLOSURE, composePreview, countChars, type ApiPost, type Page } from './content';
import { LengthMeter } from './LengthMeter';

type Mode = 'ai' | 'manual';
type Tone = 'FRIENDLY' | 'INFORMATIVE' | 'CONCISE';

const TONE_LABEL: Record<Tone, string> = {
  FRIENDLY: 'Thân thiện',
  INFORMATIVE: 'Rõ ràng, nêu công dụng',
  CONCISE: 'Ngắn gọn',
};

interface GenerateResult {
  posts: ApiPost[];
  provider: string;
  model: string;
}

export function Composer({
  orgId,
  products,
  onCreated,
  onCancel,
}: {
  orgId: string;
  products: ProductItem[];
  /** `postId` có giá trị khi vừa soạn tay một bài (để mở thẳng bài đó). */
  onCreated(result: { message: string; postId?: string }): void;
  onCancel(): void;
}) {
  const [mode, setMode] = useState<Mode>('ai');
  const [productId, setProductId] = useState(products[0]?.id ?? '');
  const [linkId, setLinkId] = useState('');
  const [mediaId, setMediaId] = useState('');
  const [tone, setTone] = useState<Tone>('FRIENDLY');
  const [count, setCount] = useState(2);
  const [body, setBody] = useState('');
  const [disclosure, setDisclosure] = useState(DEFAULT_DISCLOSURE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const links = useApi<LinkItem[]>(productId ? `/organizations/${orgId}/products/${productId}/links` : null);
  const media = useApi<Page<MediaItem>>(`/organizations/${orgId}/media/assets?limit=100`);

  // Chọn sẵn link khi danh sách link của sản phẩm về; đổi sản phẩm thì bỏ lựa chọn cũ.
  useEffect(() => {
    setLinkId(pickDefaultLink(links.data ?? []));
  }, [links.data]);

  const selectedLink = useMemo(() => links.data?.find((l) => l.id === linkId) ?? null, [links.data, linkId]);
  const preview = composePreview(body, disclosure, selectedLink?.affiliateUrl ?? null);
  // Link phải đã tải xong và thuộc đúng sản phẩm đang chọn (đổi sản phẩm thì danh sách link cũ còn hiện tới khi tải xong).
  const linkReady = !links.loading && selectedLink !== null && selectedLink.productId === productId;
  const canSubmit = productId !== '' && linkReady && (mode === 'ai' || body.trim() !== '') && !busy;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const refs = { productId, affiliateLinkId: linkId, ...(mediaId ? { mediaAssetId: mediaId } : {}) };
    try {
      if (mode === 'ai') {
        const result = await api<GenerateResult>(`/organizations/${orgId}/content/posts/generate`, {
          method: 'POST',
          body: { ...refs, tone, count },
        });
        const mock = result.provider === 'mock';
        onCreated({
          message:
            `Đã tạo ${result.posts.length} bản nháp.` +
            (mock ? ' Đây là bản nháp mẫu (giả lập) có nhãn [MẪU]: hãy viết lại nội dung thật rồi bỏ nhãn trước khi gửi duyệt.' : ' Mở từng bản để xem báo cáo QA và chỉnh sửa.'),
        });
      } else {
        const post = await api<ApiPost>(`/organizations/${orgId}/content/posts`, {
          method: 'POST',
          body: { ...refs, body: body.trim(), disclosureText: disclosure.trim() || DEFAULT_DISCLOSURE },
        });
        onCreated({ message: 'Đã tạo bản nháp.', postId: post.id });
      }
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'Không tạo được bài.');
    } finally {
      setBusy(false);
    }
  }

  if (products.length === 0) {
    return (
      <section className="card">
        <h2>Chưa có sản phẩm</h2>
        <p className="muted">Hãy thêm sản phẩm và link affiliate trước (qua Swagger hoặc nhập CSV), rồi quay lại soạn bài.</p>
        <button type="button" className="btn" onClick={onCancel}>Đóng</button>
      </section>
    );
  }

  return (
    <section className="card composer" aria-label="Tạo bài mới">
      <div className="tabs" role="tablist" aria-label="Cách tạo bài">
        <button type="button" role="tab" aria-selected={mode === 'ai'} onClick={() => setMode('ai')}>
          AI đề xuất
        </button>
        <button type="button" role="tab" aria-selected={mode === 'manual'} onClick={() => setMode('manual')}>
          Tự soạn
        </button>
      </div>

      <form className="form" onSubmit={(e) => void submit(e)}>
        <label>
          Sản phẩm
          <select value={productId} onChange={(e) => setProductId(e.target.value)}>
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>

        <label>
          Link affiliate
          <select value={linkId} onChange={(e) => setLinkId(e.target.value)} disabled={!links.data || links.data.length === 0}>
            {(links.data ?? []).map((l) => (
              <option key={l.id} value={l.id}>{linkOptionLabel(l)}</option>
            ))}
          </select>
          {links.loading && <small className="muted">Đang tải link…</small>}
          {links.error && <small className="field-error">{links.error}</small>}
          {links.data && links.data.length === 0 && (
            <small className="field-error">Sản phẩm này chưa có link affiliate. Hãy tạo link trước.</small>
          )}
          {selectedLink && !selectedLink.publishable.ok && (
            <small className="field-error">
              {selectedLink.publishable.reason} Vẫn soạn được, nhưng chưa gửi duyệt được cho tới khi link được xác minh.
            </small>
          )}
        </label>

        <label>
          Media (không bắt buộc)
          <select value={mediaId} onChange={(e) => setMediaId(e.target.value)}>
            <option value="">Không dùng media</option>
            {(media.data?.items ?? []).map((m) => (
              <option key={m.id} value={m.id}>{mediaOptionLabel(m)}</option>
            ))}
          </select>
          {media.error && <small className="field-error">{media.error}</small>}
        </label>

        {mode === 'ai' ? (
          <div className="grid-2">
            <label>
              Giọng văn
              <select value={tone} onChange={(e) => setTone(e.target.value as Tone)}>
                {(Object.keys(TONE_LABEL) as Tone[]).map((t) => (
                  <option key={t} value={t}>{TONE_LABEL[t]}</option>
                ))}
              </select>
            </label>
            <label>
              Số bản nháp
              <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
                {[1, 2, 3].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
          </div>
        ) : (
          <>
            <label>
              Nội dung bài
              <textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} />
              <small className="muted">Đừng dán link vào nội dung: hệ thống tự thêm link affiliate ở cuối bài.</small>
            </label>
            <label>
              Dòng công khai hoa hồng
              <input value={disclosure} onChange={(e) => setDisclosure(e.target.value)} maxLength={300} />
            </label>
            <LengthMeter chars={countChars(preview)} />
          </>
        )}

        {mode === 'ai' && (
          <p className="muted small">
            AI chỉ đề xuất bản nháp. Mọi bản nháp đều phải qua kiểm tra QA và do người có quyền duyệt xác nhận trước khi đi tiếp.
          </p>
        )}

        {error && <p className="notice notice-error" role="alert">{error}</p>}

        <div className="row">
          <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
            {busy ? 'Đang xử lý…' : mode === 'ai' ? 'Tạo bản nháp' : 'Lưu bản nháp'}
          </button>
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>Hủy</button>
        </div>
      </form>
    </section>
  );
}
