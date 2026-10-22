import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthenticatedRequest, UUID_RE } from '../auth/auth.types';
import { PERMISSION_KEY } from '../auth/decorators';
import { OrganizationMember } from './entities/organization-member.entity';
import { Permission, hasPermission } from './roles';

/**
 * Cô lập tenant: route có `:orgId` chỉ cho thành viên của tổ chức đó đi qua.
 * - Không phải thành viên (hoặc orgId sai định dạng) -> 404, không tiết lộ tổ chức có tồn tại.
 * - Là thành viên nhưng thiếu quyền của route (@RequirePermission) -> 403.
 * Phải đứng sau JwtAuthGuard (guard toàn cục đã chạy trước).
 */
@Injectable()
export class OrgAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectRepository(OrganizationMember)
    private readonly members: Repository<OrganizationMember>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!req.user) {
      throw new UnauthorizedException();
    }

    const orgId = req.params?.orgId;
    if (typeof orgId !== 'string' || !UUID_RE.test(orgId)) {
      throw new NotFoundException();
    }

    const membership = await this.members.findOne({
      where: { organizationId: orgId, userId: req.user.id },
    });
    if (!membership) {
      throw new NotFoundException();
    }

    const required = this.reflector.getAllAndOverride<Permission | undefined>(
      PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (required && !hasPermission(membership.role, required)) {
      throw new ForbiddenException('Bạn không có quyền thực hiện thao tác này.');
    }

    req.membership = {
      organizationId: orgId,
      memberId: membership.id,
      role: membership.role,
    };
    return true;
  }
}
