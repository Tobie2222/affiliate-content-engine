import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 8: kết nối Threads thật và đăng link affiliate ở comment.
 * - social_account_credentials: token truy cập đã MÃ HÓA, tách khỏi social_accounts để không bao giờ bị trả ra API do nhầm.
 * - published_posts: trạng thái comment chứa link (NONE | PENDING | POSTING | POSTED | FAILED), có kết quả riêng
 *   để bài đã đăng không bao giờ bị đăng lại chỉ vì comment lỗi.
 */
export class ThreadsLive1760000800000 implements MigrationInterface {
  name = 'ThreadsLive1760000800000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE social_account_credentials (
        social_account_id uuid PRIMARY KEY REFERENCES social_accounts(id) ON DELETE CASCADE,
        organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        token_ciphertext text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await q.query(`CREATE INDEX idx_social_account_credentials_org ON social_account_credentials (organization_id)`);
    await q.query(`
      ALTER TABLE published_posts
        ADD COLUMN comment_status varchar(10) NOT NULL DEFAULT 'NONE',
        ADD COLUMN comment_external_id varchar(100),
        ADD COLUMN comment_failure_kind varchar(10),
        ADD COLUMN comment_error text,
        ADD COLUMN comment_attempts int NOT NULL DEFAULT 0,
        ADD COLUMN comment_started_at timestamptz,
        ADD COLUMN comment_posted_at timestamptz,
        ADD CONSTRAINT ck_published_posts_comment_status CHECK (comment_status IN ('NONE','PENDING','POSTING','POSTED','FAILED')),
        ADD CONSTRAINT ck_published_posts_comment_failure CHECK (comment_failure_kind IS NULL OR comment_failure_kind IN ('NOT_SENT','UNKNOWN'))
    `);
    await q.query(`CREATE INDEX idx_published_posts_comment_open ON published_posts (comment_status) WHERE comment_status IN ('PENDING','POSTING')`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS idx_published_posts_comment_open`);
    await q.query(`
      ALTER TABLE published_posts
        DROP CONSTRAINT IF EXISTS ck_published_posts_comment_failure,
        DROP CONSTRAINT IF EXISTS ck_published_posts_comment_status,
        DROP COLUMN IF EXISTS comment_posted_at,
        DROP COLUMN IF EXISTS comment_started_at,
        DROP COLUMN IF EXISTS comment_attempts,
        DROP COLUMN IF EXISTS comment_error,
        DROP COLUMN IF EXISTS comment_failure_kind,
        DROP COLUMN IF EXISTS comment_external_id,
        DROP COLUMN IF EXISTS comment_status
    `);
    await q.query(`DROP TABLE IF EXISTS social_account_credentials`);
  }
}
