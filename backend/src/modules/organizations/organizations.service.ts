import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Agent } from '../agents/entities/agent.entity';
import { DEFAULT_AGENTS } from '../agents/agent.types';
import { User } from '../auth/entities/user.entity';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Organization } from './entities/organization.entity';
import { OrganizationMember } from './entities/organization-member.entity';
import { Role, canManageRole, wouldRemoveLastOwner } from './roles';
import { generateOrgSlug } from './slug';

export interface MemberView {
  id: string;
  userId: string;
  email: string;
  displayName: string;
  role: Role;
  createdAt: Date;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === '23505'
  );
}

@Injectable()
export class OrganizationsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly audit: AuditLogsService,
  ) {}

  /** Tạo tổ chức: người tạo là OWNER, đồng thời dựng sẵn 8 agent của văn phòng AI. */
  async create(
    actorId: string,
    name: string,
  ): Promise<{ id: string; name: string; slug: string; role: Role }> {
    return this.dataSource.transaction(async (manager) => {
      const org = await manager.getRepository(Organization).save(
        manager.getRepository(Organization).create({
          name: name.trim(),
          slug: generateOrgSlug(name),
        }),
      );
      await manager.getRepository(OrganizationMember).insert({
        organizationId: org.id,
        userId: actorId,
        role: Role.Owner,
      });
      await manager.getRepository(Agent).insert(
        DEFAULT_AGENTS.map((a) => ({
          organizationId: org.id,
          key: a.key,
          displayName: a.displayName,
          department: a.department,
          mapX: a.mapX,
          mapY: a.mapY,
        })),
      );
      await this.audit.record(
        {
          organizationId: org.id,
          actorId,
          action: 'organization.created',
          entityType: 'organization',
          entityId: org.id,
        },
        manager,
      );
      return { id: org.id, name: org.name, slug: org.slug, role: Role.Owner };
    });
  }

  /** Các tổ chức mà người dùng là thành viên. */
  listMine(
    userId: string,
  ): Promise<Array<{ id: string; name: string; slug: string; role: Role }>> {
    return this.dataSource.query(
      `SELECT o.id, o.name, o.slug, m.role
         FROM organization_members m
         JOIN organizations o ON o.id = m.organization_id
        WHERE m.user_id = $1 AND o.status = 'ACTIVE'
        ORDER BY o.name`,
      [userId],
    );
  }

  listMembers(organizationId: string): Promise<MemberView[]> {
    return this.dataSource.query(
      `SELECT m.id, m.user_id AS "userId", u.email, u.display_name AS "displayName",
              m.role, m.created_at AS "createdAt"
         FROM organization_members m
         JOIN users u ON u.id = m.user_id
        WHERE m.organization_id = $1
        ORDER BY m.created_at`,
      [organizationId],
    );
  }

  async addMember(
    organizationId: string,
    actor: { id: string; role: Role },
    email: string,
    role: Role,
  ): Promise<{ id: string }> {
    if (!canManageRole(actor.role, role)) {
      throw new ForbiddenException('Bạn không được cấp vai trò này.');
    }
    const user = await this.users.findOne({
      where: { email: email.trim().toLowerCase() },
      select: { id: true },
    });
    if (!user) {
      throw new NotFoundException(
        'Chưa có tài khoản với email này. Người đó cần đăng ký trước.',
      );
    }

    return this.dataSource.transaction(async (manager) => {
      let memberId: string;
      try {
        const result = await manager
          .getRepository(OrganizationMember)
          .insert({ organizationId, userId: user.id, role });
        memberId = result.identifiers[0].id as string;
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictException('Người này đã là thành viên.');
        }
        throw error;
      }
      await this.audit.record(
        {
          organizationId,
          actorId: actor.id,
          action: 'member.added',
          entityType: 'organization_member',
          entityId: memberId,
          metadata: { userId: user.id, role },
        },
        manager,
      );
      return { id: memberId };
    });
  }

  async changeRole(
    organizationId: string,
    actor: { id: string; role: Role },
    memberId: string,
    newRole: Role,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const member = await this.lockMember(manager, organizationId, memberId);
      this.assertMayChange(actor.role, member.role, newRole);
      await this.assertNotLastOwner(manager, organizationId, member.role, newRole);

      const previousRole = member.role; // ghi nhớ trước khi cập nhật, dùng cho nhật ký
      await manager
        .getRepository(OrganizationMember)
        .update({ id: member.id }, { role: newRole });
      await this.audit.record(
        {
          organizationId,
          actorId: actor.id,
          action: 'member.role_changed',
          entityType: 'organization_member',
          entityId: member.id,
          metadata: { userId: member.userId, from: previousRole, to: newRole },
        },
        manager,
      );
    });
  }

  async removeMember(
    organizationId: string,
    actor: { id: string; role: Role },
    memberId: string,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const member = await this.lockMember(manager, organizationId, memberId);
      this.assertMayChange(actor.role, member.role, null);
      await this.assertNotLastOwner(manager, organizationId, member.role, null);

      await manager.getRepository(OrganizationMember).delete({ id: member.id });
      await this.audit.record(
        {
          organizationId,
          actorId: actor.id,
          action: 'member.removed',
          entityType: 'organization_member',
          entityId: member.id,
          metadata: { userId: member.userId, role: member.role },
        },
        manager,
      );
    });
  }

  /** Tìm thành viên TRONG ĐÚNG tổ chức (chống thao tác chéo tenant) và khóa dòng. */
  private async lockMember(
    manager: EntityManager,
    organizationId: string,
    memberId: string,
  ): Promise<OrganizationMember> {
    const member = await manager.getRepository(OrganizationMember).findOne({
      where: { id: memberId, organizationId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!member) {
      throw new NotFoundException('Không tìm thấy thành viên.');
    }
    return member;
  }

  private assertMayChange(actorRole: Role, currentRole: Role, newRole: Role | null): void {
    if (!canManageRole(actorRole, currentRole)) {
      throw new ForbiddenException('Bạn không được thay đổi thành viên này.');
    }
    if (newRole !== null && !canManageRole(actorRole, newRole)) {
      throw new ForbiddenException('Bạn không được cấp vai trò này.');
    }
  }

  private async assertNotLastOwner(
    manager: EntityManager,
    organizationId: string,
    currentRole: Role,
    newRole: Role | null,
  ): Promise<void> {
    if (currentRole !== Role.Owner) {
      return;
    }
    // Khóa dòng tổ chức để hai yêu cầu song song không cùng gỡ hai OWNER cuối.
    await manager.getRepository(Organization).findOne({
      where: { id: organizationId },
      lock: { mode: 'pessimistic_write' },
    });
    const ownerCount = await manager
      .getRepository(OrganizationMember)
      .count({ where: { organizationId, role: Role.Owner } });
    if (wouldRemoveLastOwner(currentRole, newRole, ownerCount)) {
      throw new ConflictException('Tổ chức phải còn ít nhất một OWNER.');
    }
  }
}
