import { randomBytes } from 'node:crypto';
import { TokenCipher, checkEncryptionKey } from './token-cipher';

const KEY = randomBytes(32).toString('base64');

describe('TokenCipher', () => {
  it('mã hóa rồi giải mã ra đúng token; bản mã không chứa token và mỗi lần khác nhau', () => {
    const cipher = new TokenCipher(KEY);
    const a = cipher.encrypt('THQWabc.def-123');
    const b = cipher.encrypt('THQWabc.def-123');
    expect(a).not.toContain('THQWabc');
    expect(a).not.toBe(b);
    expect(cipher.decrypt(a)).toBe('THQWabc.def-123');
  });

  it('sai khóa hoặc dữ liệu bị sửa thì giải mã thất bại', () => {
    const stored = new TokenCipher(KEY).encrypt('secret-token');
    expect(() => new TokenCipher(randomBytes(32).toString('base64')).decrypt(stored)).toThrow();
    const [v, iv, tag, data] = stored.split(':');
    const flipped = Buffer.from(data, 'base64');
    flipped[0] ^= 1;
    expect(() => new TokenCipher(KEY).decrypt([v, iv, tag, flipped.toString('base64')].join(':'))).toThrow();
    expect(() => new TokenCipher(KEY).decrypt('rác')).toThrow();
  });

  it('kiểm tra khóa: thiếu, mẫu, sai độ dài đều bị từ chối; không in giá trị khóa', () => {
    expect(checkEncryptionKey(undefined)).not.toBeNull();
    expect(checkEncryptionKey('CHANGE_ME')).not.toBeNull();
    expect(checkEncryptionKey('YWJj')).not.toBeNull();
    expect(checkEncryptionKey('khong-phai-base64!!')).not.toBeNull();
    expect(checkEncryptionKey(KEY)).toBeNull();
    expect(String(checkEncryptionKey('YWJj'))).not.toContain('YWJj');
    expect(() => new TokenCipher('YWJj')).toThrow();
  });
});
