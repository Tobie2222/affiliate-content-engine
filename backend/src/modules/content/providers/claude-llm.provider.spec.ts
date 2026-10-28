import { BadGatewayException, ServiceUnavailableException } from '@nestjs/common';
import { checkLlmConfig } from '../../../config/llm-config';
import {
  CLAUDE_MAX_TOKENS,
  ClaudeLlmProvider,
  ClaudeMessage,
  ClaudeMessagesClient,
  mapClaudeError,
} from './claude-llm.provider';

const PRODUCT = { name: 'Bình giữ nhiệt 500ml', category: 'Gia dụng', description: 'Inox 304, nắp kín.' };
const REQUEST = { product: PRODUCT, count: 2, tone: 'FRIENDLY' as const };
const SECRET = 'sk-ant-SECRET-VALUE-12345';

function fakeClient(result: ClaudeMessage | Error) {
  const create = jest.fn().mockImplementation(async () => {
    if (result instanceof Error) {
      throw result;
    }
    return result;
  });
  const client: ClaudeMessagesClient = { messages: { create } };
  return { client, create };
}

function textMessage(text: string, extra: Partial<ClaudeMessage> = {}): ClaudeMessage {
  return { content: [{ type: 'text', text }], stop_reason: 'end_turn', model: 'claude-haiku-5-5', ...extra };
}

function sdkError(status: number): Error {
  return Object.assign(new Error(`HTTP ${status} key=${SECRET}`), { status });
}

describe('ClaudeLlmProvider', () => {
  it('gửi đúng model, giới hạn token, system và một tin nhắn người dùng', async () => {
    const { client, create } = fakeClient(textMessage('{"drafts":["Bản một","Bản hai"]}'));
    const result = await new ClaudeLlmProvider(client, 'claude-haiku-5-5').generateDrafts(REQUEST);
    expect(result).toEqual({ provider: 'claude', model: 'claude-haiku-5-5', drafts: ['Bản một', 'Bản hai'] });
    const params = create.mock.calls[0][0];
    expect(params.model).toBe('claude-haiku-5-5');
    expect(params.max_tokens).toBe(CLAUDE_MAX_TOKENS);
    expect(params.messages).toHaveLength(1);
    expect(params.messages[0].role).toBe('user');
    expect(params.messages[0].content).toContain('Bình giữ nhiệt 500ml');
    expect(params.system).toContain('DỮ LIỆU SẢN PHẨM');
  });

  it('có mode live', () => {
    expect(new ClaudeLlmProvider(fakeClient(textMessage('{}')).client, 'm').mode).toBe('live');
  });

  it('đọc được JSON bọc trong ```json', async () => {
    const { client } = fakeClient(textMessage('```json\n{"drafts":["A"]}\n```'));
    const result = await new ClaudeLlmProvider(client, 'm').generateDrafts(REQUEST);
    expect(result.drafts).toEqual(['A']);
  });

  it('ghép nhiều khối text và bỏ khối không phải text', async () => {
    const { client } = fakeClient({
      content: [{ type: 'thinking' }, { type: 'text', text: '{"drafts":' }, { type: 'text', text: '["Gộp"]}' }],
      stop_reason: 'end_turn',
    });
    const result = await new ClaudeLlmProvider(client, 'cấu-hình').generateDrafts(REQUEST);
    expect(result.drafts).toEqual(['Gộp']);
    expect(result.model).toBe('cấu-hình');
  });

  it('JSON hỏng -> 502 và không lộ nội dung phản hồi', async () => {
    const { client } = fakeClient(textMessage('không phải json'));
    await expect(new ClaudeLlmProvider(client, 'm').generateDrafts(REQUEST)).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('bị cắt vì max_tokens -> nói rõ phản hồi bị cắt', async () => {
    const { client } = fakeClient(textMessage('{"drafts":["dở dang', { stop_reason: 'max_tokens' }));
    await expect(new ClaudeLlmProvider(client, 'm').generateDrafts(REQUEST)).rejects.toThrow('bị cắt');
  });

  it('refusal -> 502 với thông báo rõ', async () => {
    const { client } = fakeClient(textMessage('', { stop_reason: 'refusal' }));
    await expect(new ClaudeLlmProvider(client, 'm').generateDrafts(REQUEST)).rejects.toThrow('từ chối');
  });

  it.each([
    [401, ServiceUnavailableException],
    [403, ServiceUnavailableException],
    [402, ServiceUnavailableException],
    [429, ServiceUnavailableException],
    [500, BadGatewayException],
    [529, BadGatewayException],
    [400, BadGatewayException],
  ])('lỗi %i được chuyển thành lỗi HTTP phù hợp', async (status, Expected) => {
    const { client } = fakeClient(sdkError(status));
    await expect(new ClaudeLlmProvider(client, 'm').generateDrafts(REQUEST)).rejects.toBeInstanceOf(Expected);
  });

  it('không bao giờ đưa khóa API từ thông điệp lỗi gốc ra ngoài', async () => {
    for (const status of [401, 429, 500, 400, 0]) {
      const error = mapClaudeError(sdkError(status));
      expect(error.message).not.toContain(SECRET);
      expect(JSON.stringify(error.getResponse?.() ?? error.message)).not.toContain(SECRET);
    }
  });

  it('lỗi mạng không có status -> 502', () => {
    expect(mapClaudeError(new Error('ECONNRESET'))).toBeInstanceOf(BadGatewayException);
  });
});

describe('checkLlmConfig', () => {
  it('mock không cần khóa', () => {
    expect(checkLlmConfig({ LLM_PROVIDER: 'mock' })).toEqual([]);
    expect(checkLlmConfig({})).toEqual([]);
  });

  it('claude thiếu khóa -> lỗi nêu tên biến', () => {
    const errors = checkLlmConfig({ LLM_PROVIDER: 'claude' });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('ANTHROPIC_API_KEY');
  });

  it('claude với khóa mẫu bị từ chối và lỗi không in giá trị khóa', () => {
    const errors = checkLlmConfig({ LLM_PROVIDER: 'claude', ANTHROPIC_API_KEY: 'CHANGE_ME_xyz' });
    expect(errors).toHaveLength(1);
    expect(errors.join(' ')).not.toContain('xyz');
  });

  it('claude với khóa hợp lệ và model mặc định', () => {
    expect(checkLlmConfig({ LLM_PROVIDER: 'claude', ANTHROPIC_API_KEY: SECRET })).toEqual([]);
    expect(checkLlmConfig({ LLM_PROVIDER: 'claude', ANTHROPIC_API_KEY: SECRET, ANTHROPIC_MODEL: 'claude-sonnet-5-5' })).toEqual([]);
  });

  it('tên model lạ bị từ chối', () => {
    expect(checkLlmConfig({ LLM_PROVIDER: 'claude', ANTHROPIC_API_KEY: SECRET, ANTHROPIC_MODEL: 'a b; rm -rf' })).toHaveLength(1);
  });

  it('LLM_PROVIDER ngoài danh sách bị từ chối', () => {
    expect(checkLlmConfig({ LLM_PROVIDER: 'official' })).toHaveLength(1);
  });
});
