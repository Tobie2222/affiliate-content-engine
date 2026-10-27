import { normalizeDrafts } from '../llm-draft';
import type { DraftRequest, DraftResult, LlmProvider } from './llm-provider.types';

/**
 * AI GIẢ LẬP: không gọi dịch vụ ngoài, không bịa thông số hay giá. Mọi bản nháp bắt đầu bằng "[MẪU]";
 * quy tắc QA chặn gửi duyệt cho tới khi người dùng viết lại và bỏ nhãn.
 */
export class MockLlmProvider implements LlmProvider {
  readonly mode = 'mock' as const;

  async generateDrafts(request: DraftRequest): Promise<DraftResult> {
    const name = request.product.name.trim();
    const kind = request.product.category?.trim() || 'món đồ tiện dụng';
    const templates = {
      FRIENDLY: [
        `[MẪU] Mình đang để ý ${name}. Ai đang tìm ${kind.toLowerCase()} thì có thể xem thử nhé.`,
        `[MẪU] Chia sẻ nhanh về ${name}: một lựa chọn trong nhóm ${kind.toLowerCase()} đáng để so sánh trước khi mua.`,
        `[MẪU] Bạn nào quan tâm ${kind.toLowerCase()} thì nhớ xem qua ${name} nha, mình để thông tin bên dưới.`,
      ],
      INFORMATIVE: [
        `[MẪU] ${name} thuộc nhóm ${kind.toLowerCase()}. Hãy đọc kỹ mô tả của nhà bán trước khi quyết định.`,
        `[MẪU] Thông tin cơ bản về ${name} (${kind.toLowerCase()}): xem mô tả chi tiết ở trang sản phẩm.`,
        `[MẪU] Nếu đang cân nhắc ${kind.toLowerCase()}, ${name} là một lựa chọn để đưa vào danh sách so sánh.`,
      ],
      CONCISE: [
        `[MẪU] ${name}: lựa chọn cho ai cần ${kind.toLowerCase()}.`,
        `[MẪU] Gợi ý ${kind.toLowerCase()}: ${name}.`,
        `[MẪU] ${name}, xem thử nếu bạn đang tìm ${kind.toLowerCase()}.`,
      ],
    } as const;
    return {
      provider: 'mock',
      model: 'mock-v1',
      drafts: normalizeDrafts(templates[request.tone], request.count),
    };
  }
}
