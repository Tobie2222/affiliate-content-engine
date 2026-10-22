import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration 004: kết nối affiliate, sản phẩm, link affiliate.
 * Quyết định thiết kế: `products` có organization_id (khác bản phác thảo ban đầu) để dữ liệu
 * sản phẩm của một tổ chức không bị tổ chức khác ghi đè khi nhập CSV hay đồng bộ.
 * Giá/hoa hồng NULL nghĩa là CHƯA BIẾT, khác với 0.
 */
export class AffiliateCatalog1760000300000 implements MigrationInterface {
  name = 'AffiliateCatalog1760000300000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE affiliate_connections (
        id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        provider             varchar(30) NOT NULL CHECK (provider IN ('SHOPEE')),
        external_account_id  varchar(100),
        connection_status    varchar(20) NOT NULL
                             CHECK (connection_status IN ('MOCK','ACTIVE','DISCONNECTED','ERROR')),
        credential_reference varchar(200),
        last_synced_at       timestamptz,
        created_at           timestamptz NOT NULL DEFAULT now(),
        updated_at           timestamptz NOT NULL DEFAULT now()
      )
    `);
    await q.query(
      `CREATE INDEX idx_affiliate_connections_org ON affiliate_connections (organization_id)`,
    );

    await q.query(`
      CREATE TABLE products (
        id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id         uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        provider                varchar(30) NOT NULL CHECK (provider IN ('SHOPEE')),
        external_product_id     varchar(100) NOT NULL,
        name                    varchar(500) NOT NULL,
        description             text,
        category                varchar(200),
        product_url             text NOT NULL,
        image_url               text,
        current_price           numeric(14,2) CHECK (current_price IS NULL OR current_price >= 0),
        currency                varchar(3),
        commission_rate         numeric(6,3)
                                CHECK (commission_rate IS NULL OR (commission_rate >= 0 AND commission_rate <= 100)),
        product_status          varchar(20) NOT NULL DEFAULT 'ACTIVE'
                                CHECK (product_status IN ('ACTIVE','UNAVAILABLE','ARCHIVED')),
        price_verified_at       timestamptz,
        commission_verified_at  timestamptz,
        data_source             varchar(20) NOT NULL
                                CHECK (data_source IN ('CSV','MANUAL','MOCK','API')),
        last_synced_at          timestamptz,
        created_at              timestamptz NOT NULL DEFAULT now(),
        updated_at              timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_products_org_provider_ext UNIQUE (organization_id, provider, external_product_id),
        CONSTRAINT chk_products_price_currency CHECK (current_price IS NULL OR currency IS NOT NULL)
      )
    `);
    await q.query(
      `CREATE INDEX idx_products_org_created ON products (organization_id, created_at DESC)`,
    );

    await q.query(`
      CREATE TABLE affiliate_links (
        id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        affiliate_connection_id  uuid REFERENCES affiliate_connections(id) ON DELETE SET NULL,
        product_id               uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        destination_url          text NOT NULL,
        affiliate_url            text NOT NULL,
        external_link_id         varchar(200),
        sub_id                   varchar(50),
        source                   varchar(20) NOT NULL
                                 CHECK (source IN ('USER_SUPPLIED','PROVIDER_API','MOCK')),
        link_status              varchar(20) NOT NULL
                                 CHECK (link_status IN ('UNVERIFIED','ACTIVE','INVALID','REVOKED')),
        verified_by              uuid REFERENCES users(id) ON DELETE SET NULL,
        created_by               uuid REFERENCES users(id) ON DELETE SET NULL,
        last_verified_at         timestamptz,
        created_at               timestamptz NOT NULL DEFAULT now(),
        updated_at               timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_affiliate_links_org_url UNIQUE (organization_id, affiliate_url)
      )
    `);
    await q.query(`CREATE INDEX idx_affiliate_links_product ON affiliate_links (product_id)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS affiliate_links`);
    await q.query(`DROP TABLE IF EXISTS products`);
    await q.query(`DROP TABLE IF EXISTS affiliate_connections`);
  }
}
