import { BadGatewayException, HttpException, ServiceUnavailableException } from '@nestjs/common';
import { buildDraftPrompt, parseDraftResponse } from '../llm-draft';
import type { DraftRequest, DraftResult, LlmProvider } from './llm-provider.types';

/** Phần tối thiểu của SDK Anthropic mà provider cần. Tách ra để test được mà không cần mạng hay khóa thật. */
export interface ClaudeMessage {
  content: Array<{ type: string; text?: string }>;
  stop_reason?: string | null;
  model?: string;
}

export interface ClaudeMessagesClient {
  messages: {
    create(params: {
      model: string;
      max_tokens: number;
      system: string;
      messages: Array<{ role: 'user'; content: string }>;
    }): Promise<ClaudeMessage>;
  };
}

/** Đủ chỗ cho tối đa 3 bản nháp tiếng Việt (tiếng Việt tốn nhiều token hơn tiếng Anh) cộng phần JSON. */
export const CLAUDE_MAX_TOKENS = 3000;

/**
 * Chuyển lỗi của SDK thành lỗi HTTP dễ hiểu. KHÔNG đưa nguyên văn lỗi của SDK ra ngoài:
 * thông điệp gốc có thể chứa chi tiết yêu cầu, và khóa API tuyệt đối không được lọt vào phản hồi hay log.
 */
export function mapClaudeError(error: unknown): HttpException {
  if (error instanceof HttpException) {
    return error;
  }
  const status = typeof error === 'object' && error !== null ? (error as { status?: unknown }).status : undefined;
  if (status === 401 || status === 403) {
    return new ServiceUnavailableException(
      'Khóa API của Claude bị từ chối. Hãy kiểm tra ANTHROPIC_API_KEY trong .env của backend (khóa đúng, còn hiệu lực, tài khoản đã nạp tín dụng).',
    );
  }
  if (status === 402) {
    return new ServiceUnavailableException('Tài khoản Claude hết tín dụng hoặc chưa thiết lập thanh toán.');
  }
  if (status === 429) {
    return new ServiceUnavailableException('Claude đang giới hạn tần suất hoặc đã chạm hạn mức chi tiêu. Hãy thử lại sau ít phút.');
  }
  if (typeof status === 'number' && status >= 500) {
    return new BadGatewayException('Dịch vụ Claude đang gặp sự cố tạm thời. Hãy thử lại sau.');
  }
  if (status === 400 || status === 404) {
    return new BadGatewayException('Claude từ chối yêu cầu (kiểm tra ANTHROPIC_MODEL có đúng tên model không).');
  }
  return new BadGatewayException('Không gọi được Claude. Kiểm tra kết nối mạng của backend.');
}

/**
 * Viết bản nháp bằng Claude. Kết quả là dữ liệu KHÔNG TIN CẬY: chỉ được đọc theo JSON đã định, rồi vẫn phải qua
 * QA và người duyệt. Provider này không có đường nào để đăng, duyệt hay xác nhận giấy phép.
 */
export class ClaudeLlmProvider implements LlmProvider {
  readonly mode = 'live' as const;

  constructor(
    private readonly client: ClaudeMessagesClient,
    private readonly model: string,
  ) {}

  async generateDrafts(request: DraftRequest): Promise<DraftResult> {
    const { system, user } = buildDraftPrompt(request.product, request.count, request.tone);

    let response: ClaudeMessage;
    try {
      response = await this.client.messages.create({
        model: this.model,
        max_tokens: CLAUDE_MAX_TOKENS,
        system,
        messages: [{ role: 'user', content: user }],
      });
    } catch (error) {
      throw mapClaudeError(error);
    }

    if (response.stop_reason === 'refusal') {
      throw new BadGatewayException('Claude từ chối viết nội dung cho sản phẩm này. Hãy thử sản phẩm hoặc mô tả khác.');
    }
    const text = response.content
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text as string)
      .join('\n');
    const parsed = parseDraftResponse(text, request.count);
    if (!parsed.ok) {
      const why = response.stop_reason === 'max_tokens' ? 'Phản hồi bị cắt giữa chừng.' : parsed.reason;
      throw new BadGatewayException(`Không đọc được bản nháp từ Claude: ${why} Hãy thử lại.`);
    }
    return { provider: 'claude', model: response.model || this.model, drafts: parsed.drafts };
  }
}

/**
 * Nạp SDK chính thức khi thật sự cần (chỉ khi LLM_PROVIDER=claude), để chạy chế độ mock không cần cài gói này.
 * SDK tự đặt tiêu đề xác thực và phiên bản API đúng theo tài liệu hiện hành, nên không tự viết tay ở đây.
 */
export async function loadClaudeClient(apiKey: string): Promise<ClaudeMessagesClient> {
  const specifier = '@anthropic-ai/sdk';
  let mod: { default?: unknown; Anthropic?: unknown };
  try {
    mod = (await import(specifier)) as typeof mod;
  } catch {
    throw new Error('Chưa cài gói @anthropic-ai/sdk. Chạy: npm install @anthropic-ai/sdk (trong thư mục backend).');
  }
  const Ctor = (mod.default ?? mod.Anthropic) as (new (options: { apiKey: string; maxRetries: number; timeout: number }) => ClaudeMessagesClient) | undefined;
  if (typeof Ctor !== 'function') {
    throw new Error('Không nạp được @anthropic-ai/sdk: dạng xuất của gói không như mong đợi.');
  }
  return new Ctor({ apiKey, maxRetries: 2, timeout: 60_000 });
}
