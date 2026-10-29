import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration 007: tài khoản mạng xã hội, việc đăng bài (publish_jobs) và bài đã đăng.
 * - Chưa lưu token/khóa của Threads: kết nối thật chưa làm; tài khoản MOCK chỉ để chạy thử.
 * - publish_jobs.idempotency_key UNIQUE; mỗi bài chỉ có tối đa MỘT việc đang hoạt động (QUEUED/PUBLISHING).
 * - published_posts.content_post_id UNIQUE: một bài chỉ được đăng một lần.
 */
export class Publishing1760000600000 implements MigrationInterface {
  name = 'Publishing1760000600000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE social_accounts (
        id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        platform             varchar(20) NOT NULL DEFAULT 'THREADS' CHECK (platform IN ('THREADS')),
        handle               varchar(60) NOT NULL,
        display_name         varchar(120) NOT NULL,
        external_account_id  varchar(100),
        mode                 varchar(10) NOT NULL CHECK (mode IN ('MOCK','OFFICIAL')),
        status               varchar(20) NOT NULL DEFAULT 'ACTIVE'
                             CHECK (status IN ('ACTIVE','DISCONNECTED','NEEDS_REAUTH')),
        connected_by         uuid REFERENCES users(id) ON DELETE SET NULL,
        created_at           timestamptz NOT NULL DEFAULT now(),
        updated_at           timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_social_accounts_handle UNIQUE (organization_id, platform, handle)
      )
    `);

    await q.query(`
      CREATE TABLE publish_jobs (
        id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        content_post_id    uuid NOT NULL REFERENCES content_posts(id) ON DELETE RESTRICT,
        social_account_id  uuid NOT NULL REFERENCES social_accounts(id) ON DELETE RESTRICT,
        content_version    integer NOT NULL CHECK (content_version >= 1),
        scheduled_for      timestamptz NOT NULL,
        status             varchar(12) NOT NULL
                           CHECK (status IN ('QUEUED','PUBLISHING','SUCCEEDED','FAILED','CANCELLED')),
        idempotency_key    varchar(150) NOT NULL,
        attempts           integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        started_at         timestamptz,
        finished_at        timestamptz,
        external_post_id   varchar(100),
        failure_kind       varchar(10) CHECK (failure_kind IN ('NOT_SENT','UNKNOWN')),
        retry_safe         boolean,
        last_error         text,
        scheduled_by       uuid REFERENCES users(id) ON DELETE SET NULL,
        created_at         timestamptz NOT NULL DEFAULT now(),
        updated_at         timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_publish_jobs_idempotency UNIQUE (idempotency_key)
      )
    `);
    await q.query(`CREATE INDEX idx_publish_jobs_due ON publish_jobs (status, scheduled_for)`);
    await q.query(`CREATE INDEX idx_publish_jobs_post ON publish_jobs (content_post_id, created_at DESC)`);
    await q.query(
      `CREATE UNIQUE INDEX uq_publish_jobs_one_active ON publish_jobs (content_post_id) WHERE status IN ('QUEUED','PUBLISHING')`,
    );

    await q.query(`
      CREATE TABLE published_posts (
        id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        content_post_id    uuid NOT NULL REFERENCES content_posts(id) ON DELETE RESTRICT,
        social_account_id  uuid NOT NULL REFERENCES social_accounts(id) ON DELETE RESTRICT,
        publish_job_id     uuid REFERENCES publish_jobs(id) ON DELETE SET NULL,
        external_post_id   varchar(100) NOT NULL,
        permalink          varchar(500),
        published_at       timestamptz NOT NULL,
        created_at         timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_published_posts_post UNIQUE (content_post_id),
        CONSTRAINT uq_published_posts_external UNIQUE (social_account_id, external_post_id)
      )
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS published_posts`);
    await q.query(`DROP TABLE IF EXISTS publish_jobs`);
    await q.query(`DROP TABLE IF EXISTS social_accounts`);
  }
}
