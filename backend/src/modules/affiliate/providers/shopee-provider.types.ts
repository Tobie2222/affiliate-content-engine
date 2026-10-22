/** Chế độ của nhà cung cấp: mock = dữ liệu giả để dev/test, official = API chính thức. */
export type ProviderMode = 'mock' | 'official';

/** Dạng chuỗi giống cột CSV để dùng chung bộ kiểm tra normalizeProductRow. */
export type ProviderProductRow = Record<string, string>;

export interface ProductCatalogProvider {
  readonly mode: ProviderMode;
  fetchProducts(limit: number): Promise<ProviderProductRow[]>;
}

export interface GeneratedLink {
  affiliateUrl: string;
  externalLinkId: string | null;
}

export interface AffiliateLinkProvider {
  readonly mode: ProviderMode;
  generateShortLink(input: { productUrl: string; subIds: string[] }): Promise<GeneratedLink>;
}

export type ShopeeProvider = ProductCatalogProvider & AffiliateLinkProvider;

/** Token tiêm phụ thuộc cho nhà cung cấp Shopee (mock hoặc chính thức). */
export const SHOPEE_PROVIDER = 'SHOPEE_PROVIDER';
