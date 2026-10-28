import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApi } from '../api/useApi';
import type { Page } from '../content/content';
import { useOrg } from '../org/OrgContext';
import { CsvImportPanel } from '../products/CsvImportPanel';
import { ProductFormPanel } from '../products/ProductForm';
import { SyncPanel } from '../products/SyncPanel';
import {
  DATA_SOURCE_LABEL,
  canWriteCatalog,
  formatCommission,
  formatPrice,
  scoreTone,
  type ApiProduct,
} from '../products/products';
import { Badge } from '../ui/Badge';

const PAGE_SIZE = 20;
type Panel = 'add' | 'csv' | 'sync' | null;

export function ProductsPage() {
  const { current } = useOrg();
  const navigate = useNavigate();
  const [panel, setPanel] = useState<Panel>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [searchText, setSearchText] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);

  const orgId = current?.id ?? null;
  const query = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
  if (search) {
    query.set('search', search);
  }
  const products = useApi<Page<ApiProduct>>(orgId ? `/organizations/${orgId}/products?${query.toString()}` : null);

  if (!current || !orgId) {
    return null;
  }
  const writer = canWriteCatalog(current.role);
  const total = products.data?.total ?? 0;
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + PAGE_SIZE, total);

  function finish(message: string) {
    setPanel(null);
    setNotice(message);
    setOffset(0);
    void products.reload();
  }

  function submitSearch(e: FormEvent) {
    e.preventDefault();
    setSearch(searchText.trim());
    setOffset(0);
  }

  return (
    <div>
      <header className="page-head">
        <div>
          <h1>Sản phẩm</h1>
          <p className="muted">Danh mục sản phẩm affiliate. Mỗi sản phẩm cần ít nhất một link đã xác minh trước khi đưa vào bài đăng.</p>
        </div>
        {writer && (
          <div className="row">
            <button type="button" className="btn btn-primary" onClick={() => { setNotice(null); setPanel('add'); }}>Thêm sản phẩm</button>
            <button type="button" className="btn" onClick={() => { setNotice(null); setPanel('csv'); }}>Nhập CSV</button>
            <button type="button" className="btn" onClick={() => { setNotice(null); setPanel('sync'); }}>Đồng bộ Shopee (giả lập)</button>
          </div>
        )}
      </header>

      {notice && <p className="notice notice-info" role="status">{notice}</p>}

      {panel === 'add' && (
        <ProductFormPanel
          orgId={orgId}
          onCancel={() => setPanel(null)}
          onDone={(product) => navigate(`/products/${product.id}`)}
        />
      )}
      {panel === 'csv' && <CsvImportPanel orgId={orgId} onCancel={() => setPanel(null)} onImported={finish} />}
      {panel === 'sync' && <SyncPanel orgId={orgId} onCancel={() => setPanel(null)} onSynced={finish} />}

      <section className="card list-card" aria-label="Danh sách sản phẩm">
        <div className="list-toolbar">
          <form className="inline-field" onSubmit={submitSearch} role="search">
            <input
              type="search"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Tìm theo tên sản phẩm"
              aria-label="Tìm theo tên sản phẩm"
              maxLength={100}
            />
            <button type="submit" className="btn btn-small">Tìm</button>
            {search && (
              <button type="button" className="link-btn" onClick={() => { setSearchText(''); setSearch(''); setOffset(0); }}>Xóa tìm kiếm</button>
            )}
          </form>
          <span className="muted small">
            {products.loading ? 'Đang tải…' : total === 0 ? 'Chưa có sản phẩm' : `${from}-${to} / ${total} sản phẩm`}
          </span>
        </div>

        {products.error && (
          <div>
            <p className="notice notice-error" role="alert">{products.error}</p>
            <button type="button" className="btn" onClick={() => void products.reload()}>Thử lại</button>
          </div>
        )}

        {!products.error && products.data && products.data.items.length === 0 && (
          <p className="muted empty">
            {search
              ? 'Không có sản phẩm nào khớp từ khóa này.'
              : writer
                ? 'Chưa có sản phẩm. Hãy thêm tay, nhập CSV hoặc đồng bộ dữ liệu giả lập để thử.'
                : 'Chưa có sản phẩm.'}
          </p>
        )}

        <ul className="post-list">
          {(products.data?.items ?? []).map((p) => (
            <li key={p.id}>
              <Link to={`/products/${p.id}`} className="post-row">
                <div className="post-row-main">
                  <p className="post-excerpt">{p.name}</p>
                  <p className="muted small">
                    {p.category ?? 'Chưa có danh mục'} · Giá: {formatPrice(p.currentPrice, p.currency)} · Hoa hồng: {formatCommission(p.commissionRate)}
                  </p>
                </div>
                <div className="post-row-meta">
                  <Badge tone={scoreTone(p.score.score)}>Điểm dữ liệu {p.score.score}</Badge>
                  <Badge>{DATA_SOURCE_LABEL[p.dataSource]}</Badge>
                </div>
              </Link>
            </li>
          ))}
        </ul>

        {total > PAGE_SIZE && (
          <div className="row pager">
            <button type="button" className="btn btn-small" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Trang trước</button>
            <button type="button" className="btn btn-small" disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>Trang sau</button>
          </div>
        )}
      </section>
    </div>
  );
}
