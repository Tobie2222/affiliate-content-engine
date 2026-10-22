import { getDummyHash, hashPassword, verifyPassword } from './password';
import { generateRefreshToken, hashToken } from './token';

describe('password (scrypt)', () => {
  it('băm rồi xác minh đúng mật khẩu', async () => {
    const hash = await hashPassword('Mat-khau-dai-123');
    expect(await verifyPassword('Mat-khau-dai-123', hash)).toBe(true);
  });

  it('mật khẩu sai bị từ chối', async () => {
    const hash = await hashPassword('Mat-khau-dai-123');
    expect(await verifyPassword('mat-khau-dai-123', hash)).toBe(false);
    expect(await verifyPassword('', hash)).toBe(false);
  });

  it('cùng mật khẩu cho hash khác nhau (salt ngẫu nhiên)', async () => {
    const a = await hashPassword('Mat-khau-dai-123');
    const b = await hashPassword('Mat-khau-dai-123');
    expect(a === b).toBe(false);
  });

  it('hash không chứa mật khẩu gốc và có định dạng scrypt', async () => {
    const hash = await hashPassword('Mat-khau-dai-123');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(hash.includes('Mat-khau-dai-123')).toBe(false);
  });

  it('chuỗi hash hỏng hoặc tham số bất thường trả false, không ném lỗi', async () => {
    expect(await verifyPassword('x', 'khong-phai-hash')).toBe(false);
    expect(await verifyPassword('x', 'scrypt$3$8$1$YQ==$YQ==')).toBe(false); // N không phải lũy thừa 2
    expect(await verifyPassword('x', 'scrypt$999999999$8$1$YQ==$YQ==')).toBe(false); // N quá lớn
    expect(await verifyPassword('x', 'scrypt$16384$8$1$$')).toBe(false);
  });

  it('hash giả dùng để cân bằng thời gian không khớp mật khẩu thật', async () => {
    const dummy = await getDummyHash();
    expect(await verifyPassword('mot-mat-khau-bat-ky', dummy)).toBe(false);
  });
});

describe('refresh token helpers', () => {
  it('token ngẫu nhiên, đủ dài, không trùng', () => {
    const a = generateRefreshToken();
    const b = generateRefreshToken();
    expect(a.length >= 60).toBe(true);
    expect(a === b).toBe(false);
  });

  it('hash ổn định, khác bản gốc, dài 64 ký tự hex', () => {
    const raw = generateRefreshToken();
    expect(hashToken(raw)).toBe(hashToken(raw));
    expect(hashToken(raw) === raw).toBe(false);
    expect(/^[0-9a-f]{64}$/.test(hashToken(raw))).toBe(true);
  });
});
