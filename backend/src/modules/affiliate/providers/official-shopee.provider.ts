import { NotImplementedException } from '@nestjs/common';
import {
  GeneratedLink,
  ProductCatalogProvider,
  AffiliateLinkProvider,
  ProviderProductRow,
} from './shopee-provider.types';

const MESSAGE =
  'Tích hợp Shopee Affiliate chính thức chưa được triển khai. Cần xác minh tài liệu Open API ' +
  'cho thị trường Việt Nam và có App ID/Secret được duyệt (xem docs/PHASE0.md, mục 5). ' +
  'Đặt SHOPEE_PROVIDER=mock để dùng dữ liệu giả lập khi phát triển.';

/** Chỗ giữ chỗ khi SHOPEE_PROVIDER=official: báo lỗi rõ ràng thay vì giả vờ hoạt động. */
export class OfficialShopeeProviderUnavailable
  implements ProductCatalogProvider, AffiliateLinkProvider
{
  readonly mode = 'official' as const;

  fetchProducts(_limit: number): Promise<ProviderProductRow[]> {
    throw new NotImplementedException(MESSAGE);
  }

  generateShortLink(_input: { productUrl: string; subIds: string[] }): Promise<GeneratedLink> {
    throw new NotImplementedException(MESSAGE);
  }
}

export const OFFICIAL_SHOPEE_UNAVAILABLE_MESSAGE = MESSAGE;
