import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration 008: số liệu bài đã đăng và đơn hàng affiliate.
 * - post_metrics: ảnh chụp số liệu theo thời điểm. NULL = chưa biết (khác 0).
 * - affiliate_conversions: đơn hàng nhập từ báo cáo (CSV). UNIQUE theo (tổ chức, mã đơn, mã sản phẩm) nên nhập lại
 *   cùng báo cáo chỉ cập nhật trạng thái/hoa hồng, không nhân đôi.
 */
export class Analytics1760000700000 implements MigrationInterface {
  name = 'Analytics1760000700000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE post_metrics (
        id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        published_post_id  uuid NOT NULL REFERENCES published_posts(id) ON DELETE CASCADE,
        captured_at        timestamptz NOT NULL,
        views              integer CHECK (views >= 0),
        likes              integer CHECK (likes >= 0),
        replies            integer CHECK (replies >= 0),
        reposts            integer CHECK (reposts >= 0),
        quotes             integer CHECK (quotes >= 0),
        source             varchar(10) NOT NULL CHECK (source IN ('MANUAL','API')),
        recorded_by        uuid REFERENCES users(id) ON DELETE SET NULL,
        created_at         timestamptz NOT NULL DEFAULT now()
      )
    `);
    await q.query(`CREATE INDEX idx_post_metrics_post ON post_metrics (published_post_id, captured_at DESC)`);

    await q.query(`
      CREATE TABLE affiliate_conversions (
        id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        external_order_id    varchar(100) NOT NULL,
        external_product_id  varchar(100) NOT NULL,
        order_time           timestamptz NOT NULL,
        status               varchar(10) NOT NULL CHECK (status IN ('PENDING','COMPLETED','CANCELLED')),
        commission_amount    numeric(16,2) CHECK (commission_amount >= 0),
        currency             varchar(3),
        sub_id               varchar(50),
        source               varchar(10) NOT NULL CHECK (source IN ('CSV','API')),
        imported_by          uuid REFERENCES users(id) ON DELETE SET NULL,
        created_at           timestamptz NOT NULL DEFAULT now(),
        updated_at           timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_affiliate_conversions UNIQUE (organization_id, external_order_id, external_product_id),
        CONSTRAINT chk_conversion_currency CHECK (commission_amount IS NULL OR currency IS NOT NULL)
      )
    `);
    await q.query(`CREATE INDEX idx_affiliate_conversions_time ON affiliate_conversions (organization_id, order_time DESC)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS affiliate_conversions`);
    await q.query(`DROP TABLE IF EXISTS post_metrics`);
  }
}
