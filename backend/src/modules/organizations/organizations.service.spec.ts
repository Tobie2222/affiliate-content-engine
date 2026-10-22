import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { User } from '../auth/entities/user.entity';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Organization } from './entities/organization.entity';
import { OrganizationMember } from './entities/organization-member.entity';
import { OrganizationsService } from './organizations.service';
import { Role } from './roles';

const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

type Row = Pick<OrganizationMember, 'id' | 'organizationId' | 'userId' | 'role'>;

function setup(initial: Row[]) {
  const rows: Row[] = initial.map((r) => ({ ...r }));

  const memberRepo = {
    findOne: jest.fn(async ({ where }: { where: { id: string; organizationId: string } }) =>
      rows.find((r) => r.id === where.id && r.organizationId === where.organizationId) ?? null,
    ),
    count: jest.fn(
      async ({ where }: { where: { organizationId: string; role: Role } }) =>
        rows.filter((r) => r.organizationId === where.organizationId && r.role === where.role)
          .length,
    ),
    update: jest.fn(async ({ id }: { id: string }, patch: { role: Role }) => {
      const row = rows.find((r) => r.id === id);
      if (row) row.role = patch.role;
    }),
    delete: jest.fn(async ({ id }: { id: string }) => {
      const i = rows.findIndex((r) => r.id === id);
      if (i >= 0) rows.splice(i, 1);
    }),
  };
  const orgRepo = { findOne: jest.fn(async () => ({ id: ORG_A })) };

  const manager = {
    getRepository: (entity: unknown) =>
      entity === OrganizationMember ? memberRepo : entity === Organization ? orgRepo : {},
  };
  const dataSource = {
    transaction: async (fn: (m: unknown) => Promise<unknown>) => fn(manager),
  } as unknown as DataSource;
  const audit = { record: jest.fn(async () => undefined) } as unknown as AuditLogsService;

  const service = new OrganizationsService(
    dataSource,
    {} as unknown as Repository<User>,
    audit,
  );
  return { service, rows, audit: audit as unknown as { record: jest.Mock } };
}

const OWNER_A: Row = { id: 'm-owner-a', organizationId: ORG_A, userId: 'u-owner-a', role: Role.Owner };
const ADMIN_A: Row = { id: 'm-admin-a', organizationId: ORG_A, userId: 'u-admin-a', role: Role.Admin };
const EDITOR_A: Row = { id: 'm-editor-a', organizationId: ORG_A, userId: 'u-editor-a', role: Role.ContentEditor };
const OWNER_B: Row = { id: 'm-owner-b', organizationId: ORG_B, userId: 'u-owner-b', role: Role.Owner };

const asOwner = { id: 'u-owner-a', role: Role.Owner };
const asAdmin = { id: 'u-admin-a', role: Role.Admin };

describe('OrganizationsService - cô lập tổ chức', () => {
  it('OWNER tổ chức A không đổi được vai trò của thành viên thuộc tổ chức B', async () => {
    const { service, rows } = setup([OWNER_A, OWNER_B]);
    await expect(
      service.changeRole(ORG_A, asOwner, OWNER_B.id, Role.Analyst),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(rows.find((r) => r.id === OWNER_B.id)?.role).toBe(Role.Owner);
  });

  it('OWNER tổ chức A không gỡ được thành viên thuộc tổ chức B', async () => {
    const { service, rows } = setup([OWNER_A, OWNER_B]);
    await expect(service.removeMember(ORG_A, asOwner, OWNER_B.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(rows.some((r) => r.id === OWNER_B.id)).toBe(true);
  });
});

describe('OrganizationsService - quy tắc vai trò', () => {
  it('ADMIN đổi được CONTENT_EDITOR thành REVIEWER và có ghi nhật ký', async () => {
    const { service, rows, audit } = setup([OWNER_A, ADMIN_A, EDITOR_A]);
    await service.changeRole(ORG_A, asAdmin, EDITOR_A.id, Role.Reviewer);
    expect(rows.find((r) => r.id === EDITOR_A.id)?.role).toBe(Role.Reviewer);
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record.mock.calls[0][0]).toMatchObject({
      action: 'member.role_changed',
      organizationId: ORG_A,
      metadata: { from: Role.ContentEditor, to: Role.Reviewer },
    });
  });

  it('ADMIN không được hạ cấp hay gỡ OWNER', async () => {
    const { service, rows } = setup([OWNER_A, ADMIN_A]);
    await expect(
      service.changeRole(ORG_A, asAdmin, OWNER_A.id, Role.Analyst),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.removeMember(ORG_A, asAdmin, OWNER_A.id)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(rows.find((r) => r.id === OWNER_A.id)?.role).toBe(Role.Owner);
  });

  it('ADMIN không được tự nâng người khác lên ADMIN hay OWNER', async () => {
    const { service } = setup([OWNER_A, ADMIN_A, EDITOR_A]);
    await expect(
      service.changeRole(ORG_A, asAdmin, EDITOR_A.id, Role.Admin),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.changeRole(ORG_A, asAdmin, EDITOR_A.id, Role.Owner),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('ADMIN không được gỡ một ADMIN khác', async () => {
    const otherAdmin: Row = { id: 'm-admin2', organizationId: ORG_A, userId: 'u-admin2', role: Role.Admin };
    const { service } = setup([OWNER_A, ADMIN_A, otherAdmin]);
    await expect(service.removeMember(ORG_A, asAdmin, otherAdmin.id)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('không được hạ cấp OWNER duy nhất', async () => {
    const { service, rows } = setup([OWNER_A, ADMIN_A]);
    await expect(
      service.changeRole(ORG_A, asOwner, OWNER_A.id, Role.Admin),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(rows.find((r) => r.id === OWNER_A.id)?.role).toBe(Role.Owner);
  });

  it('không được gỡ OWNER duy nhất', async () => {
    const { service, rows } = setup([OWNER_A, ADMIN_A]);
    await expect(service.removeMember(ORG_A, asOwner, OWNER_A.id)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(rows.some((r) => r.id === OWNER_A.id)).toBe(true);
  });

  it('có OWNER thứ hai thì được hạ cấp OWNER còn lại', async () => {
    const owner2: Row = { id: 'm-owner2', organizationId: ORG_A, userId: 'u-owner2', role: Role.Owner };
    const { service, rows } = setup([OWNER_A, owner2]);
    await service.changeRole(ORG_A, asOwner, owner2.id, Role.Admin);
    expect(rows.find((r) => r.id === owner2.id)?.role).toBe(Role.Admin);
  });

  it('OWNER gỡ được thành viên thường và có ghi nhật ký', async () => {
    const { service, rows, audit } = setup([OWNER_A, EDITOR_A]);
    await service.removeMember(ORG_A, asOwner, EDITOR_A.id);
    expect(rows.some((r) => r.id === EDITOR_A.id)).toBe(false);
    expect(audit.record.mock.calls[0][0]).toMatchObject({ action: 'member.removed' });
  });

  it('thao tác bị từ chối thì không ghi nhật ký', async () => {
    const { service, audit } = setup([OWNER_A, ADMIN_A]);
    await expect(
      service.changeRole(ORG_A, asAdmin, OWNER_A.id, Role.Analyst),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(audit.record).not.toHaveBeenCalled();
  });
});
