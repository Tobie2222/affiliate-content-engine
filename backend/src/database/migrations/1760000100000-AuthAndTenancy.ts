import { MigrationInterface, QueryRunner } from 'typeorm';

/** Migration 002: refresh token xoay vòng + cờ tách quyền duyệt theo tổ chức. */
export class AuthAndTenancy1760000100000 implements MigrationInterface {
  name = 'AuthAndTenancy1760000100000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE organizations
        ADD COLUMN separation_of_duties boolean NOT NULL DEFAULT true
    `);

    await q.query(`
      CREATE TABLE refresh_tokens (
        id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        family_id      uuid NOT NULL,
        token_hash     char(64) NOT NULL,
        expires_at     timestamptz NOT NULL,
        revoked_at     timestamptz,
        replaced_by_id uuid,
        created_at     timestamptz NOT NULL DEFAULT now()
      )
    `);
    await q.query(
      `CREATE UNIQUE INDEX uq_refresh_tokens_hash ON refresh_tokens (token_hash)`,
    );
    await q.query(
      `CREATE INDEX idx_refresh_tokens_family ON refresh_tokens (family_id)`,
    );
    await q.query(
      `CREATE INDEX idx_refresh_tokens_user ON refresh_tokens (user_id)`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS refresh_tokens`);
    await q.query(`ALTER TABLE organizations DROP COLUMN IF EXISTS separation_of_duties`);
  }
}
