import {
  ExecutionContext,
  SetMetadata,
  createParamDecorator,
} from '@nestjs/common';
import { Permission } from '../organizations/roles';
import type { AuthenticatedRequest } from './auth.types';

export const IS_PUBLIC_KEY = 'isPublic';
/** Đánh dấu route không cần đăng nhập. Mặc định MỌI route đều cần JWT. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const PERMISSION_KEY = 'requiredPermission';
/** Yêu cầu quyền trong tổ chức hiện tại (dùng cùng OrgAccessGuard). */
export const RequirePermission = (permission: Permission) =>
  SetMetadata(PERMISSION_KEY, permission);

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): { id: string } => {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!req.user) {
      throw new Error('CurrentUser dùng trên route chưa qua JwtAuthGuard.');
    }
    return req.user;
  },
);
