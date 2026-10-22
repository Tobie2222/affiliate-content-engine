import { BadRequestException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { ConnectionsService } from './connections.service';
import { Product } from './entities/product.entity';
import { MockShopeeProvider } from './providers/mock-shopee.provider';
import { MAX_IMPORT_ROWS, ProductsService } from './products.service';

const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACTOR = '11111111-1111-4111-8111-111111111111';

// Vị trí các tham số trong câu lệnh upsert (xem UPSERT_SQL trong products.service.ts).
const P = { org: 0, externalId: 1, price: 7, commission: 9, priceVerified: 10, commissionVerified: 11, source: 12 };

function setup() {
  const existing = new Set<string>();
  const calls: unknown[][] = [];
  const manager = {
    query: jest.fn(async (_sql: string, params: unknown[]) => {
      calls.push(params);
      const key = `${params[P.org]}|${params[P.externalId]}`;
      const inserted = !existing.has(key);
      existing.add(key);
      return [{ id: `id-${key}`, inserted }];
    }),
  };
  const dataSource = {
    transaction: async (fn: (m: unknown) => Promise<unknown>) => fn(manager),
  } as unknown as DataSource;
  const audit = { record: jest.fn(async () => undefined) };
  const connections = {
    requireUsable: jest.fn(async () => ({ id: 'conn-1' })),
    markSynced: jest.fn(async () => undefined),
  };
  const service = new ProductsService(
    dataSource,
    {} as unknown as Repository<Product>,
    new MockShopeeProvider(),
    connections as unknown as ConnectionsService,
    audit as unknown as AuditLogsService,
  );
  return { service, manager, calls, audit, connections };
}

const HEADER = 'external_product_id,name,product_url,price,currency,commission_rate';
const ROW1 = 'SP1,Bình giữ nhiệt,https://shopee.vn/p/1,189000,VND,8.5';
const ROW2 = 'SP2,Tai nghe,https://shopee.vn/p/2,,,';

describe('ProductsService.importCsv', () => {
  it('nhập các dòng hợp lệ, ghi nhật ký, luôn gắn đúng tổ chức', async () => {
    const { service, calls, audit } = setup();
    const result = await service.importCsv(ORG_A, ACTOR, { csv: [HEADER, ROW1, ROW2].join('\n') });
    expect(result).toMatchObject({ totalRows: 2, valid: 2, invalid: 0, created: 2, updated: 0, dryRun: false });
    expect(calls.every((p) => p[P.org] === ORG_A)).toBe(true);
    expect(audit.record).toHaveBeenCalledTimes(1);
  });

  it('nhập lại cùng mã sản phẩm thì tính là cập nhật, không tạo trùng', async () => {
    const { service } = setup();
    await service.importCsv(ORG_A, ACTOR, { csv: [HEADER, ROW1].join('\n') });
    const again = await service.importCsv(ORG_A, ACTOR, { csv: [HEADER, ROW1].join('\n') });
    expect(again).toMatchObject({ created: 0, updated: 1 });
  });

  it('chế độ dryRun chỉ kiểm tra, không ghi database và không ghi nhật ký', async () => {
    const { service, manager, audit } = setup();
    const result = await service.importCsv(ORG_A, ACTOR, { csv: [HEADER, ROW1].join('\n'), dryRun: true });
    expect(result).toMatchObject({ dryRun: true, valid: 1, created: 0, updated: 0 });
    expect(manager.query).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('báo từng dòng lỗi theo số dòng và vẫn nhập các dòng tốt', async () => {
    const { service } = setup();
    const bad = 'SP3,Thiếu link,,1000,VND,5';
    const result = await service.importCsv(ORG_A, ACTOR, { csv: [HEADER, ROW1, bad].join('\n') });
    expect(result).toMatchObject({ totalRows: 2, valid: 1, invalid: 1, created: 1 });
    expect(result.errors[0].line).toBe(3);
  });

  it('mã sản phẩm trùng trong cùng tệp: giữ dòng đầu, báo lỗi dòng sau', async () => {
    const { service } = setup();
    const result = await service.importCsv(ORG_A, ACTOR, { csv: [HEADER, ROW1, ROW1].join('\n') });
    expect(result).toMatchObject({ valid: 1, invalid: 1, created: 1 });
    expect(result.errors[0].errors[0].includes('trùng')).toBe(true);
  });

  it('giá/hoa hồng chưa biết ghi là null; giá 0 là giá trị thật có thời điểm xác minh', async () => {
    const { service, calls } = setup();
    const zero = 'SP4,Quà tặng,https://shopee.vn/p/4,0,VND,0';
    await service.importCsv(ORG_A, ACTOR, { csv: [HEADER, ROW2, zero].join('\n') });
    const unknown = calls.find((p) => p[P.externalId] === 'SP2')!;
    expect(unknown[P.price]).toBe(null);
    expect(unknown[P.commission]).toBe(null);
    expect(unknown[P.priceVerified]).toBe(null);
    expect(unknown[P.commissionVerified]).toBe(null);
    const real = calls.find((p) => p[P.externalId] === 'SP4')!;
    expect(real[P.price]).toBe(0);
    expect(real[P.commission]).toBe(0);
    expect(real[P.priceVerified] instanceof Date).toBe(true);
  });

  it('gắn nguồn dữ liệu CSV', async () => {
    const { service, calls } = setup();
    await service.importCsv(ORG_A, ACTOR, { csv: [HEADER, ROW1].join('\n') });
    expect(calls[0][P.source]).toBe('CSV');
  });

  it('báo các cột lạ bị bỏ qua', async () => {
    const { service } = setup();
    const csv = `${HEADER},rating\n${ROW1},4.9`;
    const result = await service.importCsv(ORG_A, ACTOR, { csv });
    expect(result.ignoredColumns).toEqual(['rating']);
  });

  it('từ chối thiếu cột bắt buộc, CSV hỏng, rỗng và quá nhiều dòng', async () => {
    const { service } = setup();
    await expect(
      service.importCsv(ORG_A, ACTOR, { csv: 'external_product_id,name\nSP1,A' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.importCsv(ORG_A, ACTOR, { csv: `${HEADER}\nSP1,"chưa đóng` }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.importCsv(ORG_A, ACTOR, { csv: HEADER })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    const many = [HEADER, ...Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `SP${i},A,https://shopee.vn/p/${i},,,`)];
    await expect(service.importCsv(ORG_A, ACTOR, { csv: many.join('\n') })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('ProductsService.sync (Shopee giả lập)', () => {
  it('đồng bộ 5 sản phẩm giả, gắn nguồn MOCK và kiểm tra kết nối thuộc đúng tổ chức', async () => {
    const { service, calls, connections } = setup();
    const result = await service.sync(ORG_A, ACTOR, 'conn-1', 50);
    expect(result).toMatchObject({ created: 5, invalid: 0, source: 'MOCK' });
    expect(connections.requireUsable).toHaveBeenCalledWith(ORG_A, 'conn-1');
    expect(connections.markSynced).toHaveBeenCalledWith('conn-1');
    expect(calls.every((p) => p[P.source] === 'MOCK')).toBe(true);
  });
});
