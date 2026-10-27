import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration 006: bài viết, lịch sử phiên bản nội dung và các lần duyệt.
 * Chưa có social_accounts/lịch đăng (Phase 5) và chưa có campaigns (làm khi cần nhóm bài).
 * `content_version` tăng mỗi khi nội dung đổi; lần duyệt gắn với đúng phiên bản (post_approvals.content_version).
 */
export class ContentPosts1760000500000 implements MigrationInterface {
  name = 'ContentPosts1760000500000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE content_posts (
        id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        product_id         uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
        affiliate_link_id  uuid NOT NULL REFERENCES affiliate_links(id) ON DELETE RESTRICT,
        media_asset_id     uuid REFERENCES media_assets(id) ON DELETE RESTRICT,
        body               text NOT NULL,
        disclosure_text    varchar(300) NOT NULL,
        status             varchar(20) NOT NULL DEFAULT 'DRAFT'
                           CHECK (status IN ('DRAFT','PENDING_APPROVAL','APPROVED','SCHEDULED','PUBLISHING',
                                             'PUBLISHED','CHANGES_REQUESTED','REJECTED','BLOCKED','FAILED')),
        content_version    integer NOT NULL DEFAULT 1 CHECK (content_version >= 1),
        author_id          uuid REFERENCES users(id) ON DELETE SET NULL,
        generated_by       varchar(10) NOT NULL CHECK (generated_by IN ('HUMAN','AI')),
        llm_provider       varchar(30),
        llm_model          varchar(100),
        blocked_reason     text,
        qa_report          jsonb,
        qa_checked_at      timestamptz,
        created_by         uuid REFERENCES users(id) ON DELETE SET NULL,
        created_at         timestamptz NOT NULL DEFAULT now(),
        updated_at         timestamptz NOT NULL DEFAULT now()
      )
    `);
    await q.query(
      `CREATE INDEX idx_content_posts_org_status ON content_posts (organization_id, status, created_at DESC)`,
    );

    await q.query(`
      CREATE TABLE content_post_versions (
        id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        content_post_id    uuid NOT NULL REFERENCES content_posts(id) ON DELETE CASCADE,
        version            integer NOT NULL CHECK (version >= 1),
        body               text NOT NULL,
        disclosure_text    varchar(300) NOT NULL,
        affiliate_link_id  uuid NOT NULL,
        media_asset_id     uuid,
        edited_by          uuid REFERENCES users(id) ON DELETE SET NULL,
        source             varchar(10) NOT NULL CHECK (source IN ('HUMAN','AI')),
        created_at         timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_content_post_versions UNIQUE (content_post_id, version)
      )
    `);

    await q.query(`
      CREATE TABLE post_approvals (
        id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        content_post_id    uuid NOT NULL REFERENCES content_posts(id) ON DELETE CASCADE,
        content_version    integer NOT NULL CHECK (content_version >= 1),
        decision           varchar(20) NOT NULL CHECK (decision IN ('APPROVED','CHANGES_REQUESTED','REJECTED')),
        reviewer_id        uuid REFERENCES users(id) ON DELETE SET NULL,
        note               text,
        created_at         timestamptz NOT NULL DEFAULT now()
      )
    `);
    await q.query(`CREATE INDEX idx_post_approvals_post ON post_approvals (content_post_id, created_at DESC)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS post_approvals`);
    await q.query(`DROP TABLE IF EXISTS content_post_versions`);
    await q.query(`DROP TABLE IF EXISTS content_posts`);
  }
}
