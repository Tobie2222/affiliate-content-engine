import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthenticatedRequest, UUID_RE } from './auth.types';
import { IS_PUBLIC_KEY } from './decorators';
import { User, UserStatus } from './entities/user.entity';

/** Guard toàn cục: mọi route đều cần access token hợp lệ, trừ route gắn @Public(). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException();
    }

    let sub: string;
    try {
      const payload = await this.jwt.verifyAsync<{ sub?: unknown }>(token, {
        algorithms: ['HS256'],
      });
      if (typeof payload.sub !== 'string' || !UUID_RE.test(payload.sub)) {
        throw new Error('sub không hợp lệ');
      }
      sub = payload.sub;
    } catch {
      throw new UnauthorizedException();
    }

    // Kiểm tra lại trạng thái để tài khoản bị khóa mất hiệu lực ngay, không chờ token hết hạn.
    const user = await this.users.findOne({
      where: { id: sub },
      select: { id: true, status: true },
    });
    if (!user || user.status !== UserStatus.Active) {
      throw new UnauthorizedException();
    }
    req.user = { id: user.id };
    return true;
  }
}
