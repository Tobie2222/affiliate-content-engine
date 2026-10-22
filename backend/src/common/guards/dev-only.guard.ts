import {
  CanActivate,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Tạm thời chặn endpoint CHƯA có xác thực trên production.
 * Phase 2 (Auth + RBAC) sẽ thay thế guard này bằng JWT + kiểm tra tổ chức.
 */
@Injectable()
export class DevOnlyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(): boolean {
    if (this.config.get<string>('NODE_ENV') === 'production') {
      throw new ForbiddenException(
        'Endpoint này chưa có xác thực và bị tắt trên production.',
      );
    }
    return true;
  }
}
