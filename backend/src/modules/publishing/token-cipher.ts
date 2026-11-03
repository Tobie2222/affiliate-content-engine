import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1';
const KEY_BYTES = 32;

/** Kiểm tra khóa mã hóa: chuỗi base64 giải ra đúng 32 byte. Trả về thông báo lỗi (không in giá trị khóa) hoặc null. */
export function checkEncryptionKey(raw: string | undefined): string | null {
  if (!raw || raw.includes('CHANGE_ME')) {
    return 'TOKEN_ENCRYPTION_KEY chưa được đặt (cần chuỗi base64 của 32 byte ngẫu nhiên).';
  }
  const bytes = Buffer.from(raw, 'base64');
  if (bytes.length !== KEY_BYTES || bytes.toString('base64').replace(/=+$/, '') !== raw.replace(/=+$/, '')) {
    return 'TOKEN_ENCRYPTION_KEY phải là chuỗi base64 của đúng 32 byte.';
  }
  return null;
}

/**
 * Mã hóa token truy cập của mạng xã hội trước khi lưu DB (AES-256-GCM, IV ngẫu nhiên mỗi lần).
 * Định dạng lưu: v1:<iv>:<tag>:<dữ liệu mã hóa>, đều base64. Sai khóa hoặc dữ liệu bị sửa thì giải mã ném lỗi.
 * Chưa hỗ trợ xoay khóa: đổi TOKEN_ENCRYPTION_KEY thì phải kết nối lại tài khoản (xem docs/OPERATIONS.md).
 */
export class TokenCipher {
  private readonly key: Buffer;

  constructor(base64Key: string) {
    const problem = checkEncryptionKey(base64Key);
    if (problem) {
      throw new Error(problem);
    }
    this.key = Buffer.from(base64Key, 'base64');
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return [VERSION, iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
  }

  decrypt(stored: string): string {
    const [version, iv, tag, data] = stored.split(':');
    if (version !== VERSION || !iv || !tag || !data) {
      throw new Error('Token đã mã hóa có định dạng không hợp lệ.');
    }
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  }
}
