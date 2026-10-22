import { CsvError, parseCsv } from './csv';
import { checkLinkPublishable } from './link-policy';
import { normalizeProductRow } from './product-normalizer';
import { scoreProduct } from './product-score';
import { parsePublicHttpsUrl } from './url-policy';

describe('parseCsv', () => {
  it('đọc tiêu đề và các dòng, tên cột chuẩn hóa về chữ thường', () => {
    const r = parseCsv('External_Product_Id,Name\n1,Áo thun\n2,Quần jean\n');
    expect(r.headers).toEqual(['external_product_id', 'name']);
    expect(r.rows.length).toBe(2);
    expect(r.rows[1].values).toEqual({ external_product_id: '2', name: 'Quần jean' });
    expect(r.rows[0].line).toBe(2);
  });

  it('giá trị trong nháy kép có thể chứa dấu phẩy, nháy kép và xuống dòng', () => {
    const r = parseCsv('id,name\n1,"Áo, loại ""xịn"""\n2,"dòng 1\ndòng 2"\n3,ok\n');
    expect(r.rows[0].values.name).toBe('Áo, loại "xịn"');
    expect(r.rows[1].values.name).toBe('dòng 1\ndòng 2');
    expect(r.rows[2].line).toBe(5); // số dòng đếm đúng sau giá trị nhiều dòng
  });

  it('chấp nhận CRLF, BOM và không có dòng xuống cuối tệp', () => {
    const r = parseCsv('﻿id,name\r\n1,a\r\n2,b');
    expect(r.headers).toEqual(['id', 'name']);
    expect(r.rows.length).toBe(2);
    expect(r.rows[1].values.name).toBe('b');
  });

  it('bỏ qua dòng trống, ô thiếu được điền chuỗi rỗng', () => {
    const r = parseCsv('id,name,price\n\n1,a\n\n');
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].values.price).toBe('');
  });

  it('ô rỗng có nháy ở cuối tệp vẫn được giữ', () => {
    const r = parseCsv('id,name\n1,""');
    expect(r.rows[0].values.name).toBe('');
  });

  it('ném CsvError với tệp sai cấu trúc', () => {
    const bad = [
      '',
      '   \n',
      'id,name\n1,"chưa đóng',
      'id,name\n1,ab"c',
      'id,name\n1,"ab"c',
      'id,id\n1,2',
      'id,\n1,2',
      'id,name\n1,a,b',
    ];
    for (const text of bad) {
      let threw = false;
      try {
        parseCsv(text);
      } catch (e) {
        threw = e instanceof CsvError;
      }
      expect(threw).toBe(true);
    }
  });
});

describe('parsePublicHttpsUrl', () => {
  it('chấp nhận https công khai và chuẩn hóa', () => {
    const r = parsePublicHttpsUrl('  https://Shop.Example.com/p/1?x=2  ');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.url.hostname).toBe('shop.example.com');
  });

  it('từ chối giao thức khác https', () => {
    for (const u of ['http://shop.example.com', 'ftp://shop.example.com', 'javascript:alert(1)', 'file:///etc/passwd']) {
      expect(parsePublicHttpsUrl(u).ok).toBe(false);
    }
  });

  it('từ chối IP, localhost, tên miền nội bộ, cổng lạ, tài khoản trong URL (chống SSRF)', () => {
    const bad = [
      'https://127.0.0.1/x',
      'https://10.0.0.5/x',
      'https://169.254.169.254/latest/meta-data',
      'https://[::1]/x',
      'https://2130706433/x',
      'https://0x7f.0.0.1/x',
      'https://localhost/x',
      'https://api.localhost/x',
      'https://db.internal/x',
      'https://printer.local/x',
      'https://intranet/x',
      'https://shop.example.com:8443/x',
      'https://user:pass@shop.example.com/x',
    ];
    for (const u of bad) {
      expect(parsePublicHttpsUrl(u).ok).toBe(false);
    }
  });

  it('từ chối rỗng, sai cú pháp và quá dài', () => {
    expect(parsePublicHttpsUrl('').ok).toBe(false);
    expect(parsePublicHttpsUrl('khong phai url').ok).toBe(false);
    expect(parsePublicHttpsUrl('https://a.example.com/' + 'x'.repeat(2100)).ok).toBe(false);
  });
});

const GOOD_ROW = {
  external_product_id: 'SP001',
  name: 'Bình giữ nhiệt',
  product_url: 'https://shop.example.com/p/sp001',
};

describe('normalizeProductRow', () => {
  it('dòng tối thiểu hợp lệ: các giá trị chưa biết là null, KHÔNG phải 0', () => {
    const r = normalizeProductRow(GOOD_ROW);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.currentPrice).toBe(null);
      expect(r.value.commissionRate).toBe(null);
      expect(r.value.currency).toBe(null);
      expect(r.value.imageUrl).toBe(null);
    }
  });

  it('giá và hoa hồng bằng 0 là giá trị thật, khác với chưa biết', () => {
    const r = normalizeProductRow({ ...GOOD_ROW, price: '0', currency: 'vnd', commission_rate: '0' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.currentPrice).toBe(0);
      expect(r.value.commissionRate).toBe(0);
      expect(r.value.currency).toBe('VND');
    }
  });

  it('đọc giá thập phân và hoa hồng có dấu %', () => {
    const r = normalizeProductRow({ ...GOOD_ROW, price: '199000.50', currency: 'VND', commission_rate: '7.5%' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.currentPrice).toBe(199000.5);
      expect(r.value.commissionRate).toBe(7.5);
    }
  });

  it('thiếu trường bắt buộc thì báo từng lỗi', () => {
    const r = normalizeProductRow({});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBe(3);
  });

  it('từ chối giá sai định dạng, tránh hiểu nhầm dấu phân cách', () => {
    for (const price of ['1,299,000', '1.299.000', '-5', '12abc', '1e6', '5.123']) {
      const r = normalizeProductRow({ ...GOOD_ROW, price, currency: 'VND' });
      expect(r.ok).toBe(false);
    }
  });

  it('có giá mà thiếu tiền tệ thì từ chối (không tự đoán VND)', () => {
    expect(normalizeProductRow({ ...GOOD_ROW, price: '100000' }).ok).toBe(false);
  });

  it('từ chối tiền tệ sai và hoa hồng ngoài 0-100', () => {
    expect(normalizeProductRow({ ...GOOD_ROW, price: '1', currency: 'DONG' }).ok).toBe(false);
    expect(normalizeProductRow({ ...GOOD_ROW, commission_rate: '101' }).ok).toBe(false);
    expect(normalizeProductRow({ ...GOOD_ROW, commission_rate: '-1' }).ok).toBe(false);
    expect(normalizeProductRow({ ...GOOD_ROW, commission_rate: 'cao' }).ok).toBe(false);
  });

  it('từ chối URL không an toàn ở product_url và image_url', () => {
    expect(normalizeProductRow({ ...GOOD_ROW, product_url: 'http://shop.example.com/x' }).ok).toBe(false);
    expect(normalizeProductRow({ ...GOOD_ROW, image_url: 'https://127.0.0.1/a.png' }).ok).toBe(false);
  });
});

describe('scoreProduct', () => {
  const full = {
    commissionRate: 20,
    currentPrice: 100000,
    imageUrl: 'https://img.example.com/a.png',
    description: 'Mô tả sản phẩm đủ dài để vượt ngưỡng tối thiểu năm mươi ký tự.',
    category: 'Gia dụng',
  };

  it('đủ dữ liệu và hoa hồng từ 20% trở lên đạt 100 điểm', () => {
    const s = scoreProduct(full);
    expect(s.score).toBe(100);
    expect(s.missing).toEqual([]);
  });

  it('hoa hồng cao hơn ngưỡng không cho thêm điểm', () => {
    expect(scoreProduct({ ...full, commissionRate: 90 }).score).toBe(100);
  });

  it('hoa hồng chưa biết được 0 điểm và bị liệt kê là thiếu; hoa hồng 0 thì không thiếu', () => {
    const unknown = scoreProduct({ ...full, commissionRate: null });
    expect(unknown.score).toBe(50);
    expect(unknown.missing).toEqual(['commissionRate']);
    const zero = scoreProduct({ ...full, commissionRate: 0 });
    expect(zero.score).toBe(50);
    expect(zero.missing).toEqual([]);
  });

  it('điểm hoa hồng tỷ lệ thuận và làm tròn', () => {
    expect(scoreProduct({ ...full, commissionRate: 10 }).breakdown[0].points).toBe(25);
    expect(scoreProduct({ ...full, commissionRate: 5 }).breakdown[0].points).toBe(13);
  });

  it('dữ liệu rỗng cho 0 điểm và liệt kê đủ chỗ thiếu', () => {
    const s = scoreProduct({ commissionRate: null, currentPrice: null, imageUrl: null, description: null, category: null });
    expect(s.score).toBe(0);
    expect(s.missing.length).toBe(5);
  });

  it('mô tả quá ngắn không được tính', () => {
    expect(scoreProduct({ ...full, description: 'ngắn' }).missing).toEqual(['description']);
  });

  it('tổng điểm từng phần bằng điểm tổng', () => {
    const s = scoreProduct({ ...full, commissionRate: 7, imageUrl: null });
    expect(s.breakdown.reduce((a, b) => a + b.points, 0)).toBe(s.score);
  });
});

describe('checkLinkPublishable', () => {
  it('link ACTIVE do API chính thức hoặc người dùng đã xác minh được phép', () => {
    expect(checkLinkPublishable({ status: 'ACTIVE', source: 'PROVIDER_API' }, 'production').ok).toBe(true);
    expect(checkLinkPublishable({ status: 'ACTIVE', source: 'USER_SUPPLIED' }, 'production').ok).toBe(true);
  });

  it('link chưa xác minh, không hợp lệ hoặc đã thu hồi bị chặn', () => {
    for (const status of ['UNVERIFIED', 'INVALID', 'REVOKED'] as const) {
      expect(checkLinkPublishable({ status, source: 'PROVIDER_API' }, 'development').ok).toBe(false);
    }
  });

  it('link MOCK chỉ dùng ngoài production', () => {
    expect(checkLinkPublishable({ status: 'ACTIVE', source: 'MOCK' }, 'development').ok).toBe(true);
    expect(checkLinkPublishable({ status: 'ACTIVE', source: 'MOCK' }, 'production').ok).toBe(false);
  });
});
