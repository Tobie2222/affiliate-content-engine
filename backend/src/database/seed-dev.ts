import dataSource from './data-source';
import { DEFAULT_AGENTS } from '../modules/agents/agent.types';

/**
 * Seed dữ liệu DEV: một tổ chức demo và 8 agent. Chạy sau khi đã chạy migration.
 *   npm run seed:dev
 */
async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Không chạy seed dev trên production.');
  }

  await dataSource.initialize();
  try {
    const rows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO organizations (name, slug)
       VALUES ($1, $2)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      ['Tổ chức demo', 'demo'],
    );
    const organizationId = rows[0].id;

    for (const agent of DEFAULT_AGENTS) {
      await dataSource.query(
        `INSERT INTO agents (organization_id, key, display_name, department, map_x, map_y)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (organization_id, key) DO NOTHING`,
        [organizationId, agent.key, agent.displayName, agent.department, agent.mapX, agent.mapY],
      );
    }

    // eslint-disable-next-line no-console
    console.log(`Đã seed tổ chức demo. organizationId = ${organizationId}`);
  } finally {
    await dataSource.destroy();
  }
}

void main();
