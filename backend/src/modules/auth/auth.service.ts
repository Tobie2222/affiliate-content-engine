import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import { getDummyHash, hashPassword, verifyPassword } from '../../common/security/password';
import { generateRefreshToken, hashToken } from '../../common/security/token';
import { AuthResult } from './auth.types';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import { RefreshToken } from './entities/refresh-token.entity';
import { User, UserStatus } from './entities/user.entity';
import { RefreshVerdict, evaluateRefresh } from './refresh-policy';

const INVALID_CREDENTIALS = 'Email hoặc mật khẩu không đúng.';
const INVALID_SESSION = 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.';

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === '23505'
  );
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(RefreshToken) private readonly tokens: Repository<RefreshToken>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResult> {
    const passwordHash = await hashPassword(dto.password);
    let user: User;
    try {
      user = await this.users.save(
        this.users.create({
          email: normalizeEmail(dto.email),
          passwordHash,
          displayName: dto.displayName.trim(),
        }),
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('Email đã được sử dụng.');
      }
      throw error;
    }
    return (await this.issueTokens(user, randomUUID())).result;
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    const user = await this.users.findOne({
      where: { email: normalizeEmail(dto.email) },
      select: {
        id: true,
        email: true,
        displayName: true,
        status: true,
        passwordHash: true,
      },
    });

    // Luôn băm một lần dù email có tồn tại hay không (chống dò email qua độ trễ).
    const passwordOk = await verifyPassword(
      dto.password,
      user?.passwordHash ?? (await getDummyHash()),
    );
    if (!user || !passwordOk || user.status !== UserStatus.Active) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    return (await this.issueTokens(user, randomUUID())).result;
  }

  /**
   * Làm mới phiên: xoay vòng refresh token. Dùng lại token đã thu hồi sẽ thu hồi cả
   * "gia đình" token (nghi bị đánh cắp), buộc đăng nhập lại.
   */
  async refresh(rawToken: string): Promise<AuthResult> {
    const outcome: { verdict: RefreshVerdict; result?: AuthResult } = {
      verdict: 'UNKNOWN',
    };

    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(RefreshToken);
      // Khóa dòng để hai yêu cầu làm mới song song không cùng thành công.
      const record = await repo.findOne({
        where: { tokenHash: hashToken(rawToken) },
        lock: { mode: 'pessimistic_write' },
      });
      const verdict = evaluateRefresh(record, new Date());
      outcome.verdict = verdict;

      if (verdict === 'REUSED' && record) {
        await this.revokeFamily(manager, record.familyId);
      }
      if (verdict !== 'OK' || !record) {
        return;
      }

      const user = await manager.getRepository(User).findOne({
        where: { id: record.userId },
      });
      if (!user || user.status !== UserStatus.Active) {
        await this.revokeFamily(manager, record.familyId);
        outcome.verdict = 'UNKNOWN';
        return;
      }

      record.revokedAt = new Date();
      const issued = await this.issueTokens(user, record.familyId, manager);
      record.replacedById = issued.refreshRowId;
      await repo.save(record);
      outcome.result = issued.result;
    });

    if (outcome.verdict !== 'OK' || !outcome.result) {
      throw new UnauthorizedException(INVALID_SESSION);
    }
    return outcome.result;
  }

  /** Đăng xuất: thu hồi cả chuỗi refresh token của phiên này. Luôn thành công. */
  async logout(rawToken: string): Promise<void> {
    const record = await this.tokens.findOne({
      where: { tokenHash: hashToken(rawToken) },
    });
    if (record) {
      await this.revokeFamily(this.dataSource.manager, record.familyId);
    }
  }

  async getProfile(userId: string): Promise<{ id: string; email: string; displayName: string }> {
    const user = await this.users.findOne({
      where: { id: userId },
      select: { id: true, email: true, displayName: true },
    });
    if (!user) {
      throw new UnauthorizedException();
    }
    return { id: user.id, email: user.email, displayName: user.displayName };
  }

  private revokeFamily(manager: EntityManager, familyId: string): Promise<unknown> {
    return manager
      .getRepository(RefreshToken)
      .update({ familyId, revokedAt: IsNull() }, { revokedAt: new Date() });
  }

  private async issueTokens(
    user: Pick<User, 'id' | 'email' | 'displayName'>,
    familyId: string,
    manager?: EntityManager,
  ): Promise<{ result: AuthResult; refreshRowId: string }> {
    const repo = manager ? manager.getRepository(RefreshToken) : this.tokens;
    const days = Number(this.config.getOrThrow('REFRESH_TTL_DAYS'));
    const expiresIn = Number(this.config.getOrThrow('JWT_ACCESS_TTL_SECONDS'));

    const refreshToken = generateRefreshToken();
    const row = await repo.save(
      repo.create({
        userId: user.id,
        familyId,
        tokenHash: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
        revokedAt: null,
        replacedById: null,
      }),
    );

    const accessToken = await this.jwt.signAsync({ sub: user.id }, { expiresIn });
    return {
      refreshRowId: row.id,
      result: {
        accessToken,
        refreshToken,
        expiresIn,
        user: { id: user.id, email: user.email, displayName: user.displayName },
      },
    };
  }
}
