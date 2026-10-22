import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration 001: nền tảng tổ chức/người dùng + khung văn phòng AI.
 * Các bảng nghiệp vụ khác được thêm ở migration sau (xem docs/PHASE0.md, mục 4).
 * gen_random_uuid() có sẵn từ PostgreSQL 13 trở lên.
 */
export class InitialFoundation1760000000000 implements MigrationInterface {
  name = 'InitialFoundation1760000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE organizations (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name        varchar(200) NOT NULL,
        slug        varchar(100) NOT NULL,
        status      varchar(20)  NOT NULL DEFAULT 'ACTIVE'
                    CHECK (status IN ('ACTIVE','SUSPENDED','DELETED')),
        created_at  timestamptz  NOT NULL DEFAULT now(),
        updated_at  timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT uq_organizations_slug UNIQUE (slug)
      )
    `);

    await q.query(`
      CREATE TABLE users (
        id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email          varchar(320) NOT NULL,
        password_hash  varchar(255) NOT NULL,
        display_name   varchar(200) NOT NULL,
        status         varchar(20)  NOT NULL DEFAULT 'ACTIVE'
                       CHECK (status IN ('ACTIVE','DISABLED')),
        created_at     timestamptz  NOT NULL DEFAULT now(),
        updated_at     timestamptz  NOT NULL DEFAULT now()
      )
    `);
    await q.query(`CREATE UNIQUE INDEX uq_users_email_lower ON users (lower(email))`);

    await q.query(`
      CREATE TABLE organization_members (
        id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role             varchar(30) NOT NULL
                         CHECK (role IN ('OWNER','ADMIN','CONTENT_EDITOR','REVIEWER','ANALYST')),
        created_at       timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_org_members_org_user UNIQUE (organization_id, user_id)
      )
    `);
    await q.query(
      `CREATE INDEX idx_org_members_user ON organization_members (user_id)`,
    );

    await q.query(`
      CREATE TABLE agents (
        id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        key              varchar(50)  NOT NULL,
        display_name     varchar(100) NOT NULL,
        department       varchar(100) NOT NULL,
        status           varchar(20)  NOT NULL DEFAULT 'IDLE'
                         CHECK (status IN ('IDLE','WORKING','WAITING_APPROVAL','ERROR','PAUSED')),
        map_x            integer NOT NULL DEFAULT 50 CHECK (map_x BETWEEN 0 AND 100),
        map_y            integer NOT NULL DEFAULT 50 CHECK (map_y BETWEEN 0 AND 100),
        created_at       timestamptz NOT NULL DEFAULT now(),
        updated_at       timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_agents_org_key UNIQUE (organization_id, key)
      )
    `);

    await q.query(`
      CREATE TABLE agent_tasks (
        id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        assigned_agent_id  uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        parent_task_id     uuid REFERENCES agent_tasks(id) ON DELETE SET NULL,
        title              varchar(300) NOT NULL,
        status             varchar(20)  NOT NULL DEFAULT 'PENDING'
                           CHECK (status IN ('PENDING','RUNNING','WAITING_APPROVAL','DONE','FAILED','CANCELLED')),
        entity_type        varchar(50),
        entity_id          uuid,
        error_message      text,
        created_at         timestamptz NOT NULL DEFAULT now(),
        updated_at         timestamptz NOT NULL DEFAULT now(),
        started_at         timestamptz,
        completed_at       timestamptz
      )
    `);
    await q.query(
      `CREATE INDEX idx_agent_tasks_org_status ON agent_tasks (organization_id, status)`,
    );
    await q.query(
      `CREATE INDEX idx_agent_tasks_agent ON agent_tasks (assigned_agent_id)`,
    );

    await q.query(`
      CREATE TABLE agent_events (
        id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        agent_id         uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        target_agent_id  uuid REFERENCES agents(id) ON DELETE SET NULL,
        task_id          uuid REFERENCES agent_tasks(id) ON DELETE SET NULL,
        type             varchar(30) NOT NULL
                         CHECK (type IN ('TASK_STARTED','TASK_COMPLETED','TASK_FAILED','HANDOFF','NEEDS_APPROVAL','STATUS_CHANGED','NOTE')),
        message          varchar(500) NOT NULL,
        payload          jsonb,
        created_at       timestamptz NOT NULL DEFAULT now()
      )
    `);
    await q.query(
      `CREATE INDEX idx_agent_events_org_created ON agent_events (organization_id, created_at DESC)`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS agent_events`);
    await q.query(`DROP TABLE IF EXISTS agent_tasks`);
    await q.query(`DROP TABLE IF EXISTS agents`);
    await q.query(`DROP TABLE IF EXISTS organization_members`);
    await q.query(`DROP TABLE IF EXISTS users`);
    await q.query(`DROP TABLE IF EXISTS organizations`);
  }
}
