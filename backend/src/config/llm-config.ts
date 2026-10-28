/** Giá trị LLM_PROVIDER hợp lệ. "mock" = bản nháp mẫu; "claude" = gọi API của Claude. */
export const LLM_PROVIDER_MODES = ['mock', 'claude'] as const;
export type LlmProviderMode = (typeof LLM_PROVIDER_MODES)[number];

export const DEFAULT_CLAUDE_MODEL = 'claude-haiku-5-5';
const PLACEHOLDER_MARKER = 'CHANGE_ME';

/**
 * Kiểm tra cấu hình AI. Trả về danh sách lỗi (rỗng nếu hợp lệ). Thông báo chỉ nêu TÊN biến,
 * không bao giờ in giá trị để khóa API không lọt vào log.
 */
export function checkLlmConfig(config: { LLM_PROVIDER?: unknown; ANTHROPIC_API_KEY?: unknown; ANTHROPIC_MODEL?: unknown }): string[] {
  const errors: string[] = [];
  const mode = config.LLM_PROVIDER ?? 'mock';
  if (typeof mode !== 'string' || !(LLM_PROVIDER_MODES as readonly string[]).includes(mode)) {
    errors.push(`LLM_PROVIDER: chỉ nhận ${LLM_PROVIDER_MODES.join(' hoặc ')}`);
    return errors;
  }
  if (mode === 'claude') {
    const key = typeof config.ANTHROPIC_API_KEY === 'string' ? config.ANTHROPIC_API_KEY.trim() : '';
    if (key === '') {
      errors.push('ANTHROPIC_API_KEY: bắt buộc khi LLM_PROVIDER=claude');
    } else if (key.includes(PLACEHOLDER_MARKER)) {
      errors.push('ANTHROPIC_API_KEY: đang là giá trị mẫu, hãy dán khóa thật');
    }
    const model = config.ANTHROPIC_MODEL;
    if (model !== undefined && model !== '' && (typeof model !== 'string' || !/^[A-Za-z0-9._-]{3,100}$/.test(model))) {
      errors.push('ANTHROPIC_MODEL: tên model không hợp lệ');
    }
  }
  return errors;
}
