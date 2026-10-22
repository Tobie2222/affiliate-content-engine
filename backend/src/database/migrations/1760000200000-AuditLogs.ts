import { MigrationInterface, QueryRunner } from 'typeorm';

/** Migration 003: nhật ký kiểm toán (audit_logs). */
export class AuditLogs1760000200000 implements MigrationInterface {
  name = 'AuditLogs1760000200000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE audit_logs (
        id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id  uuid REFERENCES organizations(id) ON DELETE SET NULL,
        actor_id         uuid REFERENCES users(id) ON DELETE SET NULL,
        action           varchar(100) NOT NULL,
        entity_type      varchar(50)  NOT NULL,
        entity_id        uuid,
        metadata         jsonb,
        created_at       timestamptz NOT NULL DEFAULT now()
      )
    `);
    await q.query(
      `CREATE INDEX idx_audit_logs_org_created ON audit_logs (organization_id, created_at DESC)`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS audit_logs`);
  }
}
