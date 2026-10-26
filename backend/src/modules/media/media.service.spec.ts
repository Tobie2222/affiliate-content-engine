import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Repository } from 'typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateMediaAssetDto, CreateMediaLicenseDto } from './dto/media.dto';
import { MediaAsset } from './entities/media-asset.entity';
import { MediaLicense } from './entities/media-license.entity';
import { MediaService, mimeMatchesType } from './media.service';

const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const EDITOR = '11111111-1111-4111-8111-111111111111';
const REVIEWER = '22222222-2222-4222-8222-222222222222';
const T0 = new Date('2026-10-26T06:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const after = (ms: number) => new Date(T0.getTime() + ms);

/** Kho dữ liệu giả trong bộ nhớ: đủ để kiểm tra logic nghiệp vụ, không thay cho test với PostgreSQL thật. */
function fakeRepo<T extends { id?: string }>(options: { uniqueOn?: string[] } = {}) {
  const rows: T[] = [];
  let counter = 0;
  const matches = (row: T, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => (row as Record<string, unknown>)[k] === v);
  return {
    rows,
    create: jest.fn((x: Partial<T>) => ({ ...x }) as T),
    save: jest.fn(async (x: T) => {
      if (options.uniqueOn) {
        const dup = rows.find((r) => options.uniqueOn!.every((k) => (r as Record<string, unknown>)[k] === (x as Record<string, unknown>)[k]));
        if (dup) {
          throw Object.assign(new Error('duplicate'), { code: '23505' });
        }
      }
      const saved = { ...x, id: `id-${++counter}`, createdAt: new Date(T0) } as T;
      rows.push(saved);
      return saved;
    }),
    findOne: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const found = rows.find((r) => matches(r, where));
      return found ? { ...found } : null;
    }),
    find: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
      rows.filter((r) => matches(r, where)).map((r) => ({ ...r })),
    ),
    update: jest.fn(async (criteria: Record<string, unknown>, patch: Record<string, unknown>) => {
      const hit = rows.filter((r) => matches(r, criteria));
      hit.forEach((r) => Object.assign(r, patch));
      return { affected: hit.length };
    }),
  };
}

function setup() {
  const assets = fakeRepo<MediaAsset>({ uniqueOn: ['organizationId', 'sourceUrl'] });
  const licenses = fakeRepo<MediaLicense>();
  const audit = { record: jest.fn(async (_entry: unknown) => undefined) };
  const service = new MediaService(
    assets as unknown as Repository<MediaAsset>,
    licenses as unknown as Repository<MediaLicense>,
    audit as unknown as AuditLogsService,
  );
  return { service, assets, licenses, audit };
}

const assetDto = (over: Partial<CreateMediaAssetDto> = {}): CreateMediaAssetDto => ({
  mediaType: 'IMAGE',
  title: 'Ảnh bình giữ nhiệt',
  sourceUrl: 'https://cdn.example.com/a.jpg',
  ...over,
});

const ownedLicense = (over: Partial<CreateMediaLicenseDto> = {}): CreateMediaLicenseDto => ({
  licenseType: 'OWNED',
  proofNote: 'Ảnh tự chụp tại cửa hàng ngày 20/10',
  commercialUseAllowed: true,
  ...over,
});

async function assetWithLicense(over: Partial<CreateMediaLicenseDto> = {}) {
  const ctx = setup();
  const asset = await ctx.service.createAsset(ORG_A, EDITOR, assetDto());
  const added = await ctx.service.addLicense(ORG_A, EDITOR, asset.id, ownedLicense(over), T0);
  return { ...ctx, asset, license: added.license, added };
}

describe('mimeMatchesType', () => {
  it('ảnh khớp image/*, video khớp video/*, sai thì từ chối', () => {
    expect(mimeMatchesType('IMAGE', 'image/jpeg')).toBe(true);
    expect(mimeMatchesType('VIDEO', 'video/mp4')).toBe(true);
    expect(mimeMatchesType('IMAGE', 'video/mp4')).toBe(false);
    expect(mimeMatchesType('VIDEO', 'image/png')).toBe(false);
    expect(mimeMatchesType('IMAGE', 'application/pdf')).toBe(false);
    expect(mimeMatchesType('IMAGE', 'image/')).toBe(false);
  });
});

describe('MediaService.createAsset', () => {
  it('tạo media ở trạng thái chưa có giấy phép và ghi nhật ký', async () => {
    const { service, audit } = setup();
    const asset = await service.createAsset(ORG_A, EDITOR, assetDto({ mimeType: 'IMAGE/JPEG' }));
    expect(asset).toMatchObject({ organizationId: ORG_A, licenseStatus: 'UNLICENSED', assetStatus: 'ACTIVE', mimeType: 'image/jpeg', createdBy: EDITOR });
    expect(audit.record).toHaveBeenCalledTimes(1);
  });

  it('từ chối URL không an toàn và kiểu tệp không khớp', async () => {
    const { service } = setup();
    await expect(service.createAsset(ORG_A, EDITOR, assetDto({ sourceUrl: 'http://cdn.example.com/a.jpg' }))).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.createAsset(ORG_A, EDITOR, assetDto({ sourceUrl: 'https://localhost/a.jpg' }))).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.createAsset(ORG_A, EDITOR, assetDto({ mimeType: 'video/mp4' }))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('cùng địa chỉ trong cùng tổ chức thì báo trùng; tổ chức khác thì được', async () => {
    const { service } = setup();
    await service.createAsset(ORG_A, EDITOR, assetDto());
    await expect(service.createAsset(ORG_A, EDITOR, assetDto())).rejects.toBeInstanceOf(ConflictException);
    await expect(service.createAsset(ORG_B, EDITOR, assetDto())).resolves.toBeDefined();
  });
});

describe('MediaService - luồng giấy phép', () => {
  it('giấy phép mới khai báo ở trạng thái chờ duyệt: media NEEDS_REVIEW, chưa dùng được', async () => {
    const { service, asset, license, added } = await assetWithLicense();
    expect(license.reviewStatus).toBe('PENDING');
    expect(added.assessment).toMatchObject({ status: 'NEEDS_REVIEW', usable: false });
    await expect(service.assertUsable(ORG_A, asset.id, T0)).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('người có quyền duyệt xác nhận thì media dùng được và ghi nhật ký có người tạo/người duyệt', async () => {
    const { service, asset, license, assets, audit } = await assetWithLicense();
    const r = await service.reviewLicense(ORG_A, REVIEWER, license.id, { decision: 'APPROVE' }, T0);
    expect(r.license).toMatchObject({ reviewStatus: 'APPROVED', reviewedBy: REVIEWER });
    expect(r.assessment).toMatchObject({ status: 'VALID', usable: true });
    await expect(service.assertUsable(ORG_A, asset.id, T0)).resolves.toMatchObject({ usable: true });
    expect(assets.rows[0].licenseStatus).toBe('VALID');
    const last = audit.record.mock.calls[audit.record.mock.calls.length - 1][0] as { action: string; metadata: { createdBy: string } };
    expect(last.action).toBe('media.license.approved');
    expect(last.metadata.createdBy).toBe(EDITOR);
  });

  it('từ chối cần lý do; sau khi từ chối media bị REJECTED', async () => {
    const { service, asset, license } = await assetWithLicense();
    await expect(service.reviewLicense(ORG_A, REVIEWER, license.id, { decision: 'REJECT' }, T0)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.reviewLicense(ORG_A, REVIEWER, license.id, { decision: 'REJECT', note: 'ab' }, T0)).rejects.toBeInstanceOf(BadRequestException);
    const r = await service.reviewLicense(ORG_A, REVIEWER, license.id, { decision: 'REJECT', note: 'Thiếu bằng chứng' }, T0);
    expect(r.assessment.status).toBe('REJECTED');
    await expect(service.assertUsable(ORG_A, asset.id, T0)).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('một giấy phép chỉ xử lý được một lần', async () => {
    const { service, license } = await assetWithLicense();
    await service.reviewLicense(ORG_A, REVIEWER, license.id, { decision: 'APPROVE' }, T0);
    await expect(service.reviewLicense(ORG_A, REVIEWER, license.id, { decision: 'REJECT', note: 'đổi ý rồi' }, T0)).rejects.toBeInstanceOf(ConflictException);
  });

  it('không duyệt được giấy phép đã hết hạn tại thời điểm duyệt', async () => {
    const { service, license } = await assetWithLicense({ validUntil: '2026-10-30' });
    await expect(service.reviewLicense(ORG_A, REVIEWER, license.id, { decision: 'APPROVE' }, after(10 * DAY))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('dữ liệu giấy phép sai bị từ chối với danh sách lỗi', async () => {
    const { service, asset } = await assetWithLicense();
    await expect(service.addLicense(ORG_A, EDITOR, asset.id, { licenseType: 'CC_BY', commercialUseAllowed: true }, T0)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('MediaService - cô lập tổ chức', () => {
  it('tổ chức khác không xem, thêm giấy phép, duyệt hay lưu trữ được media/giấy phép của tổ chức này', async () => {
    const { service, asset, license } = await assetWithLicense();
    await expect(service.get(ORG_B, asset.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.addLicense(ORG_B, EDITOR, asset.id, ownedLicense(), T0)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.reviewLicense(ORG_B, REVIEWER, license.id, { decision: 'APPROVE' }, T0)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.archive(ORG_B, REVIEWER, asset.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.assertUsable(ORG_B, asset.id, T0)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('MediaService - lưu trữ', () => {
  it('media đã lưu trữ: không thêm giấy phép, không dùng được dù giấy phép còn hạn', async () => {
    const { service, asset, license } = await assetWithLicense();
    await service.reviewLicense(ORG_A, REVIEWER, license.id, { decision: 'APPROVE' }, T0);
    await service.archive(ORG_A, EDITOR, asset.id);
    await expect(service.assertUsable(ORG_A, asset.id, T0)).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(service.addLicense(ORG_A, EDITOR, asset.id, ownedLicense(), T0)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('MediaService - hết hạn và kiểm tra lại', () => {
  it('assertUsable tính theo thời điểm gọi: đang dùng được, sau hạn thì bị chặn dù bản lưu tạm chưa cập nhật', async () => {
    const { service, asset, license, assets } = await assetWithLicense({ validUntil: '2026-11-30' });
    await service.reviewLicense(ORG_A, REVIEWER, license.id, { decision: 'APPROVE' }, T0);
    await expect(service.assertUsable(ORG_A, asset.id, after(5 * DAY))).resolves.toMatchObject({ usable: true });
    await expect(service.assertUsable(ORG_A, asset.id, after(40 * DAY))).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(assets.rows[0].licenseStatus).toBe('VALID'); // bản lưu tạm cũ, chính là lý do phải tính lại khi dùng
  });

  it('recheckAll cập nhật bản lưu tạm: sắp hết hạn rồi hết hạn, và báo đúng thay đổi', async () => {
    const { service, license, assets } = await assetWithLicense({ validUntil: '2026-11-30' });
    await service.reviewLicense(ORG_A, REVIEWER, license.id, { decision: 'APPROVE' }, T0);

    const soon = await service.recheckAll(ORG_A, REVIEWER, after(30 * DAY));
    expect(soon).toMatchObject({ checked: 1, changed: 1, expiringSoon: 1, truncated: false });
    expect(soon.changes[0]).toMatchObject({ from: 'VALID', to: 'EXPIRING_SOON' });
    expect(assets.rows[0].licenseStatus).toBe('EXPIRING_SOON');

    const same = await service.recheckAll(ORG_A, REVIEWER, after(31 * DAY));
    expect(same.changed).toBe(0);

    const expired = await service.recheckAll(ORG_A, REVIEWER, after(40 * DAY));
    expect(expired.changes[0]).toMatchObject({ from: 'EXPIRING_SOON', to: 'EXPIRED' });
    expect(assets.rows[0].licenseStatus).toBe('EXPIRED');
  });

  it('recheckAll chỉ xét media của đúng tổ chức và bỏ qua media đã lưu trữ', async () => {
    const { service, assets } = setup();
    await service.createAsset(ORG_A, EDITOR, assetDto({ sourceUrl: 'https://cdn.example.com/1.jpg' }));
    const b = await service.createAsset(ORG_B, EDITOR, assetDto({ sourceUrl: 'https://cdn.example.com/2.jpg' }));
    const c = await service.createAsset(ORG_A, EDITOR, assetDto({ sourceUrl: 'https://cdn.example.com/3.jpg' }));
    await service.archive(ORG_A, EDITOR, c.id);
    const r = await service.recheckAll(ORG_A, REVIEWER, T0);
    expect(r.checked).toBe(1);
    expect(assets.rows.find((x) => x.id === b.id)?.licenseCheckedAt).toBeDefined();
  });

  it('usability trả dòng ghi nguồn bắt buộc cho CC BY', async () => {
    const { service, asset, license } = await assetWithLicense({
      licenseType: 'CC_BY',
      proofUrl: 'https://example.com/photo/1',
      licensorName: 'Nguyễn A',
      attributionText: 'Ảnh: Nguyễn A / CC BY 4.0',
      proofNote: undefined,
    });
    await service.reviewLicense(ORG_A, REVIEWER, license.id, { decision: 'APPROVE' }, T0);
    const a = await service.assess(ORG_A, asset.id, T0);
    expect(a.attributions).toEqual(['Ảnh: Nguyễn A / CC BY 4.0']);
  });
});
