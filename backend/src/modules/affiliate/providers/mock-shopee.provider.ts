import { randomBytes } from 'node:crypto';
import {
  GeneratedLink,
  ProductCatalogProvider,
  AffiliateLinkProvider,
  ProviderProductRow,
} from './shopee-provider.types';

/**
 * =====  MOCK — KHÔNG PHẢI TÍCH HỢP SHOPEE THẬT  =====
 * Dữ liệu giả để phát triển và kiểm thử. Tên sản phẩm có tiền tố "[MOCK]", URL dùng tên miền
 * `.invalid` (chuẩn quốc tế đảm bảo không tồn tại thật). Một số giá/hoa hồng cố tình để trống để
 * thể hiện "chưa biết". Thay bằng tích hợp chính thức khi đã có quyền API (xem docs/PHASE0.md).
 */
const MOCK_PRODUCTS: ProviderProductRow[] = [
  {
    external_product_id: 'MOCK-001',
    name: '[MOCK] Bình giữ nhiệt 500ml',
    product_url: 'https://mock-shop.invalid/p/MOCK-001',
    category: 'Gia dụng',
    price: '189000',
    currency: 'VND',
    commission_rate: '8.5',
    description: 'Sản phẩm giả lập dùng để thử nghiệm quy trình, không phải hàng thật.',
  },
  {
    external_product_id: 'MOCK-002',
    name: '[MOCK] Tai nghe không dây',
    product_url: 'https://mock-shop.invalid/p/MOCK-002',
    category: 'Phụ kiện',
    price: '259000',
    currency: 'VND',
    commission_rate: '',
  },
  {
    external_product_id: 'MOCK-003',
    name: '[MOCK] Balo laptop chống nước',
    product_url: 'https://mock-shop.invalid/p/MOCK-003',
    category: 'Thời trang',
    price: '',
    currency: '',
    commission_rate: '12',
  },
  {
    external_product_id: 'MOCK-004',
    name: '[MOCK] Đèn bàn LED',
    product_url: 'https://mock-shop.invalid/p/MOCK-004',
    price: '0',
    currency: 'VND',
    commission_rate: '0',
  },
  {
    external_product_id: 'MOCK-005',
    name: '[MOCK] Sổ tay bìa cứng',
    product_url: 'https://mock-shop.invalid/p/MOCK-005',
    category: 'Văn phòng phẩm',
  },
];

export class MockShopeeProvider implements ProductCatalogProvider, AffiliateLinkProvider {
  readonly mode = 'mock' as const;

  async fetchProducts(limit: number): Promise<ProviderProductRow[]> {
    return MOCK_PRODUCTS.slice(0, Math.max(0, limit)).map((p) => ({ ...p }));
  }

  async generateShortLink(input: {
    productUrl: string;
    subIds: string[];
  }): Promise<GeneratedLink> {
    const id = randomBytes(6).toString('hex');
    const suffix = input.subIds.length > 0 ? `?sub=${encodeURIComponent(input.subIds.join('_'))}` : '';
    return {
      affiliateUrl: `https://mock-affiliate.invalid/s/${id}${suffix}`,
      externalLinkId: `mock-${id}`,
    };
  }
}
