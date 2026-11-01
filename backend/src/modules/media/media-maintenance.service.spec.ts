import { Repository } from 'typeorm';
import { Organization } from '../organizations/entities/organization.entity';
import { MediaMaintenanceService } from './media-maintenance.service';
import { MediaService } from './media.service';

const NOW = new Date('2026-11-01T02:00:00Z');

function setup(orgIds: string[], behaviour: Record<string, () => Promise<unknown>> = {}) {
  const orgs = { find: async () => orgIds.map((id) => ({ id })) };
  const calls: Array<{ org: string; actor: unknown; now: Date }> = [];
  const media = {
    recheckAll: async (org: string, actor: unknown, now: Date) => {
      calls.push({ org, actor, now });
      if (behaviour[org]) {
        return behaviour[org]();
      }
      return { checked: 3, changed: 1, expiringSoon: 0, changes: [], truncated: false };
    },
  };
  const service = new MediaMaintenanceService(orgs as unknown as Repository<Organization>, media as unknown as MediaService);
  return { service, calls };
}

describe('MediaMaintenanceService', () => {
  it('quét từng tổ chức với người thực hiện là hệ thống (null) và cộng kết quả', async () => {
    const { service, calls } = setup(['o1', 'o2']);
    const summary = await service.recheckAllOrganizations(NOW);
    expect(summary).toEqual({ organizations: 2, failed: 0, checked: 6, changed: 2 });
    expect(calls.map((c) => c.org)).toEqual(['o1', 'o2']);
    expect(calls.every((c) => c.actor === null && c.now === NOW)).toBe(true);
  });

  it('một tổ chức lỗi không làm dừng các tổ chức còn lại', async () => {
    const { service, calls } = setup(['o1', 'o2', 'o3'], { o2: async () => { throw new Error('db down: secret'); } });
    const summary = await service.recheckAllOrganizations(NOW);
    expect(summary).toEqual({ organizations: 3, failed: 1, checked: 6, changed: 2 });
    expect(calls).toHaveLength(3);
  });

  it('không có tổ chức nào thì không làm gì', async () => {
    const { service, calls } = setup([]);
    expect(await service.recheckAllOrganizations(NOW)).toEqual({ organizations: 0, failed: 0, checked: 0, changed: 0 });
    expect(calls).toHaveLength(0);
  });
});
