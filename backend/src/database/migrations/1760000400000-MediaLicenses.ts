import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration 005: hồ sơ media và giấy phép.
 * Giai đoạn này CHỈ lưu hồ sơ + URL nguồn của media, chưa lưu file (chưa chọn nơi lưu trữ).
 * `license_status`, `license_expires_at` là bản lưu tạm của kết quả đánh giá để lọc danh sách;
 * trạng thái chính xác tại thời điểm dùng luôn được tính lại từ các giấy phép (xem license-policy.ts).
 */
export class MediaLicenses1760000400000 implements MigrationInterface {
  name = 'MediaLicenses1760000400000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE media_assets (
        id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        media_type          varchar(10) NOT NULL CHECK (media_type IN ('IMAGE','VIDEO')),
        title               varchar(200) NOT NULL,
        description         text,
        source_url          text NOT NULL,
        mime_type           varchar(100),
        asset_status        varchar(10) NOT NULL DEFAULT 'ACTIVE' CHECK (asset_status IN ('ACTIVE','ARCHIVED')),
        license_status      varchar(20) NOT NULL DEFAULT 'UNLICENSED'
                            CHECK (license_status IN ('UNLICENSED','NEEDS_REVIEW','VALID','EXPIRING_SOON','EXPIRED','RESTRICTED','REJECTED')),
        license_expires_at  timestamptz,
        license_checked_at  timestamptz,
        created_by          uuid REFERENCES users(id) ON DELETE SET NULL,
        created_at          timestamptz NOT NULL DEFAULT now(),
        updated_at          timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_media_assets_org_url UNIQUE (organization_id, source_url)
      )
    `);
    await q.query(
      `CREATE INDEX idx_media_assets_org_status ON media_assets (organization_id, asset_status, license_status, created_at DESC)`,
    );

    await q.query(`
      CREATE TABLE media_licenses (
        id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        media_asset_id         uuid NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
        license_type           varchar(30) NOT NULL
                               CHECK (license_type IN ('OWNED','CC0','CC_BY','COMMERCIAL_PURCHASED','PARTNER_GRANTED')),
        licensor_name          varchar(200),
        proof_url              text,
        proof_note             text,
        attribution_text       varchar(500),
        commercial_use_allowed boolean NOT NULL,
        valid_from             timestamptz,
        valid_until            timestamptz,
        review_status          varchar(10) NOT NULL DEFAULT 'PENDING'
                               CHECK (review_status IN ('PENDING','APPROVED','REJECTED')),
        reviewed_by            uuid REFERENCES users(id) ON DELETE SET NULL,
        reviewed_at            timestamptz,
        review_note            text,
        created_by             uuid REFERENCES users(id) ON DELETE SET NULL,
        created_at             timestamptz NOT NULL DEFAULT now(),
        updated_at             timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT chk_media_licenses_dates CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until > valid_from),
        CONSTRAINT chk_media_licenses_review CHECK (
          (review_status = 'PENDING' AND reviewed_by IS NULL AND reviewed_at IS NULL)
          OR (review_status <> 'PENDING' AND reviewed_at IS NOT NULL)
        )
      )
    `);
    await q.query(
      `CREATE INDEX idx_media_licenses_asset ON media_licenses (organization_id, media_asset_id)`,
    );
    await q.query(
      `CREATE INDEX idx_media_licenses_expiry ON media_licenses (valid_until) WHERE valid_until IS NOT NULL`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS media_licenses`);
    await q.query(`DROP TABLE IF EXISTS media_assets`);
  }
}
