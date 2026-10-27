import type { DraftProductFacts, Tone } from '../llm-draft';

export interface DraftRequest {
  product: DraftProductFacts;
  count: number;
  tone: Tone;
}

export interface DraftResult {
  provider: string;
  model: string;
  drafts: string[];
}

/**
 * Nhà cung cấp mô hình ngôn ngữ. Chỉ ĐỀ XUẤT bản nháp; không có phương thức đăng, duyệt hay xác nhận giấy phép.
 * `mode === 'mock'`: dữ liệu mẫu, tự động gắn nhãn [MẪU] để buộc người dùng viết lại trước khi duyệt.
 */
export interface LlmProvider {
  readonly mode: 'mock' | 'live';
  generateDrafts(request: DraftRequest): Promise<DraftResult>;
}

export const LLM_PROVIDER = Symbol('LLM_PROVIDER');
