import { BadRequestException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AffiliateLinksService } from './affiliate-links.service';
import { ConnectionsService } from './connections.service';
import { AffiliateLink } from './entities/affiliate-link.entity';
import { ProductsService } from './products.service';
import { ShopeeProvider } from './providers/shopee-provider.types';

const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACTOR = '11111111-1111-4111-8111-111111111111';
const PRODUCT = 'p0000000-0000-4000-8000-000000000001';
const URL1 = 'https://s.shopee.vn/AbCdEf';
const URL2 = 'https://s.shopee.vn/XyZxYz';

function setup() {
  const rows: Array<Record<string, unknown>> = [];
  const links = {
    create: (x: Record<string, unknown>) => ({ ...x }),
    save: async (x: Record<string, unknown>) => {
      const saved = { ...x, id: `l-${rows.length + 1}`, createdAt: new Date() };
      rows.push(saved);
      return { ...saved };
    },
    findOne: async ({ where }: { where: Record<string, unknown> }) =>
      rows.find((r) => Object.entries(where).every(([k, v]) => r[k] === v)) ?? null,
  };
  const products = { requireProduct: async () => ({ id: PRODUCT, productUrl: 'https://shopee.vn/p/1' }) };
  const audit = { record: async () => undefined };
  const config = { get: () => 'development' };
  const service = new AffiliateLinksService(
    links as unknown as Repository<AffiliateLink>,
    {} as unknown as ShopeeProvider,
    products as unknown as ProductsService,
    {} as unknown as ConnectionsService,
    audit as unknown as AuditLogsService,
    config as unknown as ConfigService,
  );
  return { service, rows };
}

describe('AffiliateLinksService.createUserSupplied: sub_id', () => {
  it('không có sub_id thì lưu null (hành vi cũ)', async () => {
    const { service, rows } = setup();
    await service.createUserSupplied(ORG, ACTOR, PRODUCT, URL1);
    expect(rows[0]).toMatchObject({ subId: null, source: 'USER_SUPPLIED', linkStatus: 'UNVERIFIED' });
  });

  it('lưu sub_id đã cắt khoảng trắng; link vẫn chưa xác minh', async () => {
    const { service, rows } = setup();
    const view = await service.createUserSupplied(ORG, ACTOR, PRODUCT, URL1, '  bai-001 ');
    expect(rows[0]).toMatchObject({ subId: 'bai-001', linkStatus: 'UNVERIFIED' });
    expect(view.publishable.ok).toBe(false);
  });

  it('sub_id rỗng sau khi cắt được coi là không có', async () => {
    const { service, rows } = setup();
    await service.createUserSupplied(ORG, ACTOR, PRODUCT, URL1, '   ');
    expect(rows[0]).toMatchObject({ subId: null });
  });

  it('từ chối ký tự lạ và sub_id quá dài', async () => {
    const { service, rows } = setup();
    await expect(service.createUserSupplied(ORG, ACTOR, PRODUCT, URL1, 'bài 1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.createUserSupplied(ORG, ACTOR, PRODUCT, URL1, 'a'.repeat(51))).rejects.toBeInstanceOf(BadRequestException);
    expect(rows).toHaveLength(0);
  });

  it('từ chối sub_id đã dùng cho link khác trong tổ chức', async () => {
    const { service, rows } = setup();
    await service.createUserSupplied(ORG, ACTOR, PRODUCT, URL1, 'bai-001');
    await expect(service.createUserSupplied(ORG, ACTOR, PRODUCT, URL2, 'bai-001')).rejects.toBeInstanceOf(ConflictException);
    expect(rows).toHaveLength(1);
  });
});
