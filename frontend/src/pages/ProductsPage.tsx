export function ProductsPage() {
  return (
    <div>
      <header className="page-head">
        <div>
          <h1>Sản phẩm</h1>
          <p className="muted">Danh mục sản phẩm affiliate và link của bạn.</p>
        </div>
      </header>
      <section className="card">
        <h2>Màn hình này sẽ có ở bước sau</h2>
        <p>
          Phần máy chủ đã sẵn sàng: nhập CSV, đồng bộ Shopee giả lập, tạo và xác minh link affiliate.
          Trong lúc chờ giao diện, bạn dùng được các chức năng này qua{' '}
          <a href="/api/docs" target="_blank" rel="noreferrer">trang Swagger</a>.
        </p>
      </section>
    </div>
  );
}
