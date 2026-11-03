import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { SocialAccountCredential } from './entities/social-account-credential.entity';
import { TokenCipher, checkEncryptionKey } from './token-cipher';

/** Lưu và đọc token Threads đã mã hóa. Token giải mã chỉ tồn tại trong bộ nhớ, đúng lúc gọi Threads. */
@Injectable()
export class SocialCredentialsService {
  private cipherInstance: TokenCipher | null = null;

  constructor(
    @InjectRepository(SocialAccountCredential) private readonly credentials: Repository<SocialAccountCredential>,
    private readonly config: ConfigService,
  ) {}

  private cipher(): TokenCipher {
    if (!this.cipherInstance) {
      const key = this.config.get<string>('TOKEN_ENCRYPTION_KEY');
      const problem = checkEncryptionKey(key);
      if (problem || !key) {
        throw new ServiceUnavailableException(problem ?? 'Thiếu TOKEN_ENCRYPTION_KEY.');
      }
      this.cipherInstance = new TokenCipher(key);
    }
    return this.cipherInstance;
  }

  /** Mã hóa và ghi (thay thế nếu đã có) trong cùng giao dịch với tài khoản. */
  async store(manager: EntityManager, organizationId: string, accountId: string, token: string): Promise<void> {
    const repo = manager.getRepository(SocialAccountCredential);
    await repo.save(repo.create({ socialAccountId: accountId, organizationId, tokenCiphertext: this.cipher().encrypt(token) }));
  }

  /** Token đã giải mã, hoặc null nếu tài khoản chưa có token. Ném lỗi nếu giải mã thất bại (sai khóa, dữ liệu hỏng). */
  async tokenFor(organizationId: string, accountId: string): Promise<string | null> {
    const row = await this.credentials.findOne({ where: { socialAccountId: accountId, organizationId } });
    return row ? this.cipher().decrypt(row.tokenCiphertext) : null;
  }

  async remove(organizationId: string, accountId: string): Promise<void> {
    await this.credentials.delete({ socialAccountId: accountId, organizationId });
  }
}
