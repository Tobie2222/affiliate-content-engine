import {
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Repository } from 'typeorm';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { OrganizationMember } from './entities/organization-member.entity';
import { OrgAccessGuard } from './org-access.guard';
import { Permission, Role } from './roles';

const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USER_A = '11111111-1111-4111-8111-111111111111'; // thành viên của ORG_A
const USER_B = '22222222-2222-4222-8222-222222222222'; // thành viên của ORG_B
const USER_X = '33333333-3333-4333-8333-333333333333'; // không thuộc tổ chức nào

const MEMBERS: Array<Pick<OrganizationMember, 'id' | 'organizationId' | 'userId' | 'role'>> = [
  { id: 'm-a', organizationId: ORG_A, userId: USER_A, role: Role.Analyst },
  { id: 'm-b', organizationId: ORG_B, userId: USER_B, role: Role.Owner },
];

function setup(requiredPermission?: Permission) {
  const findOne = jest.fn(
    async ({ where }: { where: { organizationId: string; userId: string } }) =>
      MEMBERS.find(
        (m) => m.organizationId === where.organizationId && m.userId === where.userId,
      ) ?? null,
  );
  const guard = new OrgAccessGuard(
    { getAllAndOverride: jest.fn().mockReturnValue(requiredPermission) } as unknown as Reflector,
    { findOne } as unknown as Repository<OrganizationMember>,
  );
  const run = (req: Partial<AuthenticatedRequest>) =>
    guard.canActivate({
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => function handler() {},
      getClass: () => class Controller {},
    } as unknown as ExecutionContext);
  return { run, findOne };
}

describe('OrgAccessGuard - cô lập giữa các tổ chức', () => {
  it('chưa đăng nhập -> 401', async () => {
    const { run } = setup();
    await expect(run({ params: { orgId: ORG_A } })).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('orgId sai định dạng -> 404 và không truy vấn DB', async () => {
    const { run, findOne } = setup();
    await expect(
      run({ user: { id: USER_A }, params: { orgId: "1'; DROP TABLE users;--" } }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(findOne).not.toHaveBeenCalled();
  });

  it('người dùng của tổ chức B truy cập tổ chức A -> 404 (không lộ tổ chức A tồn tại)', async () => {
    const { run } = setup();
    await expect(
      run({ user: { id: USER_B }, params: { orgId: ORG_A } }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('người không thuộc tổ chức nào -> 404', async () => {
    const { run } = setup();
    await expect(
      run({ user: { id: USER_X }, params: { orgId: ORG_A } }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('truy vấn thành viên luôn lọc theo CẢ orgId trên đường dẫn và userId từ token', async () => {
    const { run, findOne } = setup();
    await run({ user: { id: USER_A }, params: { orgId: ORG_A } });
    expect(findOne).toHaveBeenCalledWith({
      where: { organizationId: ORG_A, userId: USER_A },
    });
  });

  it('thành viên đúng tổ chức, route không đòi quyền riêng -> cho qua và gắn membership', async () => {
    const { run } = setup();
    const req: Partial<AuthenticatedRequest> = { user: { id: USER_A }, params: { orgId: ORG_A } };
    expect(await run(req)).toBe(true);
    expect(req.membership).toEqual({ organizationId: ORG_A, memberId: 'm-a', role: Role.Analyst });
  });

  it('là thành viên nhưng thiếu quyền của route -> 403', async () => {
    const { run } = setup(Permission.MembersManage); // ANALYST không có quyền này
    await expect(
      run({ user: { id: USER_A }, params: { orgId: ORG_A } }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('là thành viên và đủ quyền -> cho qua', async () => {
    const { run } = setup(Permission.AnalyticsRead);
    expect(await run({ user: { id: USER_A }, params: { orgId: ORG_A } })).toBe(true);
  });

  it('quyền ở tổ chức này không áp dụng cho tổ chức khác (OWNER của B vẫn 404 ở A)', async () => {
    const { run } = setup(Permission.OrgManage);
    await expect(
      run({ user: { id: USER_B }, params: { orgId: ORG_A } }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
