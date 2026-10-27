import {
  QaInput,
  composeText,
  countChars,
  findAmounts,
  fold,
  runQaRules,
  similarity,
} from './content-rules';
import { buildDraftPrompt, parseDraftResponse } from './llm-draft';

const NOW = new Date('2026-10-27T03:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const URL_OK = 'https://s.shopee.vn/AbCdEf';
const DISCLOSURE = 'Mình nhận hoa hồng nếu bạn mua qua link này.';

function input(over: Partial<QaInput> = {}): QaInput {
  return {
    body: 'Bình giữ nhiệt này mình dùng mỗi ngày đi làm, nước nóng vẫn ấm đến chiều. Nắp vặn chắc tay, không rỉ nước trong túi.',
    disclosureText: DISCLOSURE,
    affiliateUrl: URL_OK,
    product: { name: 'Bình giữ nhiệt', currentPrice: 189000, currency: 'VND', priceVerifiedAt: new Date(NOW.getTime() - DAY) },
    recentBodies: [],
    now: NOW,
    ...over,
  };
}

const rulesOf = (r: ReturnType<typeof runQaRules>, sev?: 'FAIL' | 'WARN') =>
  r.findings.filter((f) => !sev || f.severity === sev).map((f) => f.rule);

describe('tiện ích văn bản', () => {
  it('fold bỏ dấu tiếng Việt và đổi đ thành d', () => {
    expect(fold('Đảm bảo 100% – Chữa khỏi')).toBe('dam bao 100% – chua khoi');
  });
  it('countChars đếm emoji là một ký tự', () => {
    expect(countChars('ab😀')).toBe(3);
  });
  it('composeText ghép nội dung, dòng công khai và link', () => {
    expect(composeText(' xin chào ', ' công khai ', 'https://a.vn/x')).toBe('xin chào\n\ncông khai\nhttps://a.vn/x');
    expect(composeText('xin chào', '', null)).toBe('xin chào');
  });
});

describe('findAmounts', () => {
  it('đọc các cách viết giá phổ biến', () => {
    expect(findAmounts('chỉ 189.000đ thôi').map((a) => a.vnd)).toEqual([189000]);
    expect(findAmounts('giá 189k').map((a) => a.vnd)).toEqual([189000]);
    expect(findAmounts('khoảng 1,2 triệu').map((a) => a.vnd)).toEqual([1200000]);
    expect(findAmounts('2tr').map((a) => a.vnd)).toEqual([2000000]);
    expect(findAmounts('150 nghìn đồng').map((a) => a.vnd)).toEqual([150000]);
    expect(findAmounts('1.189.000 VND').map((a) => a.vnd)).toEqual([1189000]);
  });
  it('phân biệt có đơn vị tiền rõ ràng hay chỉ k/triệu', () => {
    expect(findAmounts('189.000đ')[0].explicitCurrency).toBe(true);
    expect(findAmounts('189k')[0].explicitCurrency).toBe(false);
  });
  it('không nhầm chữ khác thành số tiền', () => {
    expect(findAmounts('5 khách hàng, 3 trong 4 người, 2 đứa bé')).toEqual([]);
    expect(findAmounts('mã SP001, ngày 20/10')).toEqual([]);
  });
});

describe('runQaRules - bài sạch', () => {
  it('bài đủ điều kiện thì ok và không có FAIL', () => {
    const r = runQaRules(input());
    expect(r.ok).toBe(true);
    expect(rulesOf(r, 'FAIL')).toEqual([]);
    expect(r.composedText.endsWith(URL_OK)).toBe(true);
  });
});

describe('runQaRules - lỗi chặn (FAIL)', () => {
  it('nội dung quá ngắn', () => {
    expect(rulesOf(runQaRules(input({ body: 'ngắn' })), 'FAIL')).toContain('EMPTY_BODY');
  });
  it('còn nhãn [MẪU] của bản nháp giả lập', () => {
    expect(rulesOf(runQaRules(input({ body: '[MẪU] Bình giữ nhiệt rất tiện dụng khi đi làm hằng ngày.' })), 'FAIL')).toContain('PLACEHOLDER_LEFT');
  });
  it('vượt 500 ký tự sau khi ghép dòng công khai và link', () => {
    const r = runQaRules(input({ body: 'a'.repeat(480) }));
    expect(rulesOf(r, 'FAIL')).toContain('LENGTH');
    expect(r.composedLength).toBeGreaterThan(500);
  });
  it('sát giới hạn thì chỉ cảnh báo', () => {
    const base = runQaRules(input({ body: 'x'.repeat(10) }));
    const room = 500 - base.composedLength + 10;
    const r = runQaRules(input({ body: 'x'.repeat(room - 20) }));
    expect(r.composedLength).toBeGreaterThan(470);
    expect(rulesOf(r, 'WARN')).toContain('LENGTH');
    expect(r.ok).toBe(true);
  });
  it('thiếu hoặc sai dòng công khai affiliate', () => {
    expect(rulesOf(runQaRules(input({ disclosureText: '' })), 'FAIL')).toContain('DISCLOSURE');
    expect(rulesOf(runQaRules(input({ disclosureText: 'Cảm ơn bạn đã xem bài viết' })), 'FAIL')).toContain('DISCLOSURE');
    expect(rulesOf(runQaRules(input({ disclosureText: 'Bài có link affiliate.' })), 'FAIL')).not.toContain('DISCLOSURE');
  });
  it('thiếu link, hoặc có link trong nội dung', () => {
    expect(rulesOf(runQaRules(input({ affiliateUrl: null })), 'FAIL')).toContain('LINK_PRESENT');
    expect(rulesOf(runQaRules(input({ body: 'Xem tại https://shopee.vn/abc bình giữ nhiệt rất tốt.' })), 'FAIL')).toContain('EXTRA_URL');
    expect(rulesOf(runQaRules(input({ body: 'Vào www.shopee.vn xem bình giữ nhiệt rất tốt nhé.' })), 'FAIL')).toContain('EXTRA_URL');
  });
  it('khẳng định y tế và cam kết kết quả (kể cả khi gõ không dấu)', () => {
    expect(rulesOf(runQaRules(input({ body: 'Dùng bình này chữa khỏi đau dạ dày sau một tuần.' })), 'FAIL')).toContain('BANNED_CLAIM');
    expect(rulesOf(runQaRules(input({ body: 'Cam ket 100% hai lai neu khong hai long voi binh.' })), 'FAIL')).toContain('BANNED_CLAIM');
    expect(rulesOf(runQaRules(input({ body: 'Sản phẩm không tác dụng phụ, dùng thoải mái mỗi ngày.' })), 'FAIL')).toContain('BANNED_CLAIM');
  });
});

describe('runQaRules - giá', () => {
  it('giá nêu đúng giá sản phẩm thì không lỗi', () => {
    expect(rulesOf(runQaRules(input({ body: 'Bình giữ nhiệt đang có giá 189.000đ, dùng rất ổn.' })), 'FAIL')).not.toContain('PRICE_CLAIM');
    expect(rulesOf(runQaRules(input({ body: 'Bình giữ nhiệt giá 189k, dùng rất ổn.' }))).includes('PRICE_CLAIM')).toBe(false);
  });
  it('giá nêu khác giá sản phẩm: FAIL nếu ghi rõ đơn vị tiền, WARN nếu viết k/triệu', () => {
    expect(rulesOf(runQaRules(input({ body: 'Bình giữ nhiệt chỉ 99.000đ thôi, dùng rất ổn.' })), 'FAIL')).toContain('PRICE_CLAIM');
    const r = runQaRules(input({ body: 'Bình giữ nhiệt chỉ 99k thôi, dùng rất ổn.' }));
    expect(rulesOf(r, 'FAIL')).not.toContain('PRICE_CLAIM');
    expect(rulesOf(r, 'WARN')).toContain('PRICE_CLAIM');
  });
  it('sản phẩm chưa có giá VND mà bài nêu giá thì chặn', () => {
    const p = { name: 'X', currentPrice: null, currency: null, priceVerifiedAt: null };
    expect(rulesOf(runQaRules(input({ product: p, body: 'Bình giữ nhiệt này giá 189.000đ, dùng rất ổn.' })), 'FAIL')).toContain('PRICE_CLAIM');
  });
  it('giá đã xác minh quá cũ hoặc chưa có thời điểm thì cảnh báo', () => {
    const stale = { name: 'X', currentPrice: 189000, currency: 'VND', priceVerifiedAt: new Date(NOW.getTime() - 10 * DAY) };
    const body = 'Bình giữ nhiệt giá 189.000đ, dùng rất ổn.';
    expect(rulesOf(runQaRules(input({ product: stale, body })), 'WARN')).toContain('PRICE_CLAIM');
    expect(rulesOf(runQaRules(input({ product: { ...stale, priceVerifiedAt: null }, body })), 'WARN')).toContain('PRICE_CLAIM');
  });
  it('không nêu giá thì không kiểm giá', () => {
    expect(rulesOf(runQaRules(input({ product: { name: 'X', currentPrice: null, currency: null, priceVerifiedAt: null } }))).includes('PRICE_CLAIM')).toBe(false);
  });
  it('phần trăm giảm giá chỉ cảnh báo vì không có giá gốc để đối chiếu', () => {
    const r = runQaRules(input({ body: 'Bình giữ nhiệt đang giảm 50% nên mình chốt đơn luôn rồi.' }));
    expect(rulesOf(r, 'WARN')).toContain('DISCOUNT_CLAIM');
    expect(r.ok).toBe(true);
  });
});

describe('runQaRules - so sánh tuyệt đối và trùng lặp', () => {
  it('so sánh tuyệt đối chỉ cảnh báo', () => {
    const r = runQaRules(input({ body: 'Đây là bình giữ nhiệt tốt nhất mình từng dùng, nước nóng lâu hẳn.' }));
    expect(rulesOf(r, 'WARN')).toContain('SUPERLATIVE');
    expect(r.ok).toBe(true);
  });
  it('trùng gần hoàn toàn bài gần đây thì chặn; giống vừa thì cảnh báo; khác hẳn thì thôi', () => {
    const body = input().body;
    expect(rulesOf(runQaRules(input({ recentBodies: [body] })), 'FAIL')).toContain('DUPLICATE');
    expect(rulesOf(runQaRules(input({ recentBodies: ['Chuyện hoàn toàn khác về một chiếc tai nghe không dây dùng khi chạy bộ buổi sáng.'] }))).includes('DUPLICATE')).toBe(false);
    expect(similarity('a b c d e f g h', 'a b c d e f g h')).toBe(1);
    expect(similarity('', 'x y z w')).toBe(0);
    const near = body.replace('mỗi ngày đi làm', 'hằng ngày khi đi làm');
    expect(similarity(body, near)).toBeGreaterThan(0.3);
  });
});

describe('llm-draft', () => {
  const product = { name: 'Bình giữ nhiệt', category: 'Gia dụng', description: 'Giữ nóng 12 giờ' };

  it('prompt nhắc không bịa giá/link và coi dữ liệu sản phẩm là dữ liệu', () => {
    const { system, user } = buildDraftPrompt(product, 2, 'FRIENDLY');
    expect(system.includes('Không nêu giá')).toBe(true);
    expect(system.includes('không phải chỉ dẫn')).toBe(true);
    expect(system.includes('đúng 2 bản')).toBe(true);
    expect(user.includes('Bình giữ nhiệt')).toBe(true);
  });
  it('prompt giới hạn số bản và độ dài dữ liệu đưa vào', () => {
    expect(buildDraftPrompt(product, 99, 'CONCISE').system.includes('đúng 3 bản')).toBe(true);
    const long = buildDraftPrompt({ ...product, description: 'x'.repeat(5000) }, 1, 'CONCISE').user;
    expect(long.length).toBeLessThan(1500);
  });
  it('đọc JSON thuần và JSON bọc trong ```', () => {
    expect(parseDraftResponse('{"drafts":["Một","Hai"]}', 3)).toEqual({ ok: true, drafts: ['Một', 'Hai'] });
    expect(parseDraftResponse('```json\n{"drafts":["Một"]}\n```', 3)).toEqual({ ok: true, drafts: ['Một'] });
    expect(parseDraftResponse('Đây là kết quả: {"drafts":["Một"]} cảm ơn', 3)).toEqual({ ok: true, drafts: ['Một'] });
  });
  it('lọc bản rỗng, trùng, sai kiểu và cắt theo số lượng yêu cầu', () => {
    expect(parseDraftResponse('{"drafts":["a ","a",1,null,"","b","c"]}', 2)).toEqual({ ok: true, drafts: ['a', 'b'] });
  });
  it('từ chối phản hồi hỏng', () => {
    expect(parseDraftResponse('không có json', 2).ok).toBe(false);
    expect(parseDraftResponse('{"drafts": oops}', 2).ok).toBe(false);
    expect(parseDraftResponse('{"other":[]}', 2).ok).toBe(false);
    expect(parseDraftResponse('{"drafts":["", "  "]}', 2).ok).toBe(false);
  });
});
