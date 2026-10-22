import { evaluateRefresh } from './refresh-policy';

const now = new Date('2026-10-21T00:00:00Z');
const future = new Date('2026-11-21T00:00:00Z');
const past = new Date('2026-09-21T00:00:00Z');

describe('evaluateRefresh', () => {
  it('token không tồn tại -> UNKNOWN', () => {
    expect(evaluateRefresh(null, now)).toBe('UNKNOWN');
  });

  it('token còn hạn và chưa thu hồi -> OK', () => {
    expect(evaluateRefresh({ expiresAt: future, revokedAt: null }, now)).toBe('OK');
  });

  it('token hết hạn -> EXPIRED', () => {
    expect(evaluateRefresh({ expiresAt: past, revokedAt: null }, now)).toBe('EXPIRED');
  });

  it('hết hạn đúng thời điểm hiện tại vẫn bị coi là hết hạn', () => {
    expect(evaluateRefresh({ expiresAt: now, revokedAt: null }, now)).toBe('EXPIRED');
  });

  it('token đã thu hồi mà bị dùng lại -> REUSED (kể cả khi còn hạn)', () => {
    expect(evaluateRefresh({ expiresAt: future, revokedAt: past }, now)).toBe('REUSED');
  });

  it('token đã thu hồi và hết hạn vẫn là REUSED', () => {
    expect(evaluateRefresh({ expiresAt: past, revokedAt: past }, now)).toBe('REUSED');
  });
});
