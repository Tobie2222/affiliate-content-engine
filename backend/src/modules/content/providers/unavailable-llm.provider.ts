import { ServiceUnavailableException } from '@nestjs/common';
import type { DraftResult, LlmProvider } from './llm-provider.types';

/** Chỗ giữ chỗ cho nhà cung cấp AI thật. Chưa triển khai vì chưa chọn nhà cung cấp và chưa có khóa API. */
export class UnavailableLlmProvider implements LlmProvider {
  readonly mode = 'live' as const;

  // eslint-disable-next-line @typescript-eslint/require-await
  async generateDrafts(): Promise<DraftResult> {
    throw new ServiceUnavailableException(
      'Nhà cung cấp AI thật chưa được triển khai. Đặt LLM_PROVIDER=mock để dùng bản nháp mẫu.',
    );
  }
}
