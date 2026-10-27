/**
 * Bộ quy tắc QA cho bài viết (logic thuần, không DB). Dùng ở bước "gửi duyệt" và "duyệt" để chặn các lỗi
 * hiển nhiên TRƯỚC khi người duyệt mất thời gian. Đây là kiểm tra heuristic, KHÔNG phải tư vấn pháp lý
 * và KHÔNG thay người duyệt: kết quả sạch chỉ nghĩa là chưa phát hiện lỗi theo các quy tắc dưới đây.
 */

export const THREADS_MAX_CHARS = 500;
export const THREADS_WARN_CHARS = 470;
export const MIN_BODY_CHARS = 10;
export const PRICE_STALE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export type Severity = 'FAIL' | 'WARN';

export type RuleId =
  | 'EMPTY_BODY'
  | 'PLACEHOLDER_LEFT'
  | 'LENGTH'
  | 'DISCLOSURE'
  | 'LINK_PRESENT'
  | 'EXTRA_URL'
  | 'BANNED_CLAIM'
  | 'SUPERLATIVE'
  | 'PRICE_CLAIM'
  | 'DISCOUNT_CLAIM'
  | 'DUPLICATE'
  | 'LINK_STATUS'
  | 'MEDIA_RIGHTS';

export interface RuleFinding {
  rule: RuleId;
  severity: Severity;
  message: string;
}

export interface QaProduct {
  name: string;
  currentPrice: number | null;
  currency: string | null;
  priceVerifiedAt: Date | null;
}

export interface QaInput {
  body: string;
  disclosureText: string;
  affiliateUrl: string | null;
  product: QaProduct;
  /** Nội dung các bài gần đây của cùng tổ chức (để phát hiện trùng lặp). */
  recentBodies: ReadonlyArray<string>;
  now: Date;
}

export interface QaReport {
  /** true khi không có FAIL (có thể vẫn có WARN để người duyệt cân nhắc). */
  ok: boolean;
  findings: RuleFinding[];
  composedText: string;
  composedLength: number;
}

/** Đếm theo ký tự Unicode (không phải đơn vị UTF-16) để emoji tính là 1. */
export function countChars(text: string): number {
  return Array.from(text).length;
}

/** Văn bản sẽ đăng: nội dung + dòng công khai quan hệ affiliate + link. */
export function composeText(body: string, disclosureText: string, affiliateUrl: string | null): string {
  const parts = [body.trim(), disclosureText.trim()].filter((p) => p.length > 0);
  let text = parts.join('\n\n');
  if (affiliateUrl) {
    text += `\n${affiliateUrl}`;
  }
  return text;
}

/** Bỏ dấu tiếng Việt và hạ chữ thường để so khớp từ khóa không phụ thuộc cách gõ dấu. */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase();
}

// ---------- Từ khóa ----------

const DISCLOSURE_KEYWORDS = ['hoa hong', 'affiliate', 'tiep thi lien ket', 'quang cao', '#ad', 'tai tro'];

// Khẳng định y tế/cam kết kết quả: rủi ro cao nên CHẶN (FAIL).
const BANNED_CLAIMS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  { pattern: /\b(chua khoi|khoi benh|tri dut diem|dieu tri (benh|ung thu|tieu duong))\b/, label: 'khẳng định chữa bệnh' },
  { pattern: /\b(cam ket|dam bao) (100|hieu qua|khoi|thanh cong|hoan tien)\b/, label: 'cam kết/đảm bảo kết quả' },
  { pattern: /\b(khong (co )?tac dung phu|an toan tuyet doi|100% an toan)\b/, label: 'khẳng định an toàn tuyệt đối' },
  { pattern: /\b(giam can|tang chieu cao|trang da) (nhanh|sau|chi trong|trong \d+)\b/, label: 'hứa hẹn kết quả cơ thể nhanh' },
  { pattern: /\b(duoc )?(bo y te|fda) (chung nhan|phe duyet|cap phep)\b/, label: 'viện dẫn chứng nhận cơ quan quản lý' },
];

// So sánh/tuyệt đối khó kiểm chứng: CẢNH BÁO để người duyệt cân nhắc.
const SUPERLATIVES: ReadonlyArray<RegExp> = [
  /\b(so 1|so mot|number one|no\.?1)\b/,
  /\b(tot|re|hay|ngon|chat) nhat\b/,
  /\bduy nhat\b/,
  /\b(re nhat|gia re nhat) (thi truong|viet nam|thi gioi)\b/,
];

const PLACEHOLDER = /\[(mau|placeholder|todo)\]/;

const URL_PATTERN = /(https?:\/\/|www\.)\S+/i;

// ---------- Giá ----------

export interface ParsedAmount {
  raw: string;
  vnd: number;
  /** true nếu ghi rõ đơn vị tiền tệ (đ, ₫, vnd, đồng); false nếu chỉ k/nghìn/triệu. */
  explicitCurrency: boolean;
}

function parseNumberToken(token: string): number | null {
  const t = token.trim();
  if (/^\d{1,3}([.,]\d{3})+$/.test(t)) {
    return Number(t.replace(/[.,]/g, '')); // 189.000 hoặc 1,189,000: dấu phân cách hàng nghìn
  }
  if (/^\d+[.,]\d+$/.test(t)) {
    return Number(t.replace(',', '.')); // 1,2 (triệu)
  }
  if (/^\d+$/.test(t)) {
    return Number(t);
  }
  return null;
}

const AMOUNT_PATTERN =
  /(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?)\s*(triệu|trieu|tr|nghìn|nghin|ngàn|ngan|k|đồng|dong|vnđ|vnd|đ|₫)(?![\p{L}\p{N}])/giu;

/** Tìm các số tiền được nêu trong văn bản (tiếng Việt). Trả về giá trị quy ra VND. */
export function findAmounts(text: string): ParsedAmount[] {
  const found: ParsedAmount[] = [];
  for (const match of text.matchAll(AMOUNT_PATTERN)) {
    const value = parseNumberToken(match[1]);
    if (value === null) {
      continue;
    }
    const unit = fold(match[2]);
    let multiplier = 1;
    let explicit = false;
    if (unit === 'k' || unit === 'nghin' || unit === 'ngan') {
      multiplier = 1000;
    } else if (unit === 'tr' || unit === 'trieu') {
      multiplier = 1_000_000;
    } else {
      explicit = true; // đ, ₫, vnd, vnđ, đồng
    }
    found.push({ raw: match[0], vnd: Math.round(value * multiplier), explicitCurrency: explicit });
  }
  return found;
}

const formatVnd = (n: number) => `${n.toLocaleString('en-US').replace(/,/g, '.')}đ`;

// ---------- Trùng lặp ----------

function shingles(text: string, size = 4): Set<string> {
  const words = fold(text).replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  const set = new Set<string>();
  if (words.length < size) {
    if (words.length > 0) {
      set.add(words.join(' '));
    }
    return set;
  }
  for (let i = 0; i <= words.length - size; i++) {
    set.add(words.slice(i, i + size).join(' '));
  }
  return set;
}

/** Độ giống nhau 0..1 (Jaccard trên cụm 4 từ). */
export function similarity(a: string, b: string): number {
  const sa = shingles(a);
  const sb = shingles(b);
  if (sa.size === 0 || sb.size === 0) {
    return 0;
  }
  let inter = 0;
  for (const s of sa) {
    if (sb.has(s)) {
      inter += 1;
    }
  }
  return inter / (sa.size + sb.size - inter);
}

export const DUPLICATE_FAIL = 0.8;
export const DUPLICATE_WARN = 0.6;

// ---------- Chạy toàn bộ quy tắc ----------

export function runQaRules(input: QaInput): QaReport {
  const findings: RuleFinding[] = [];
  const add = (rule: RuleId, severity: Severity, message: string) => findings.push({ rule, severity, message });

  const body = input.body.trim();
  const folded = fold(`${body}\n${input.disclosureText}`);

  if (countChars(body) < MIN_BODY_CHARS) {
    add('EMPTY_BODY', 'FAIL', `Nội dung quá ngắn (tối thiểu ${MIN_BODY_CHARS} ký tự).`);
  }
  if (PLACEHOLDER.test(fold(body))) {
    add('PLACEHOLDER_LEFT', 'FAIL', 'Còn nhãn [MẪU] của bản nháp giả lập. Hãy viết lại nội dung thật rồi bỏ nhãn.');
  }

  const composedText = composeText(body, input.disclosureText, input.affiliateUrl);
  const composedLength = countChars(composedText);
  if (composedLength > THREADS_MAX_CHARS) {
    add('LENGTH', 'FAIL', `Bài dài ${composedLength} ký tự, vượt giới hạn ${THREADS_MAX_CHARS} của Threads (đã tính dòng công khai và link).`);
  } else if (composedLength > THREADS_WARN_CHARS) {
    add('LENGTH', 'WARN', `Bài dài ${composedLength}/${THREADS_MAX_CHARS} ký tự, sát giới hạn.`);
  }

  const disclosure = input.disclosureText.trim();
  if (disclosure.length < 10 || !DISCLOSURE_KEYWORDS.some((k) => fold(disclosure).includes(k))) {
    add('DISCLOSURE', 'FAIL', 'Thiếu dòng công khai quan hệ affiliate (ví dụ: "Mình nhận hoa hồng nếu bạn mua qua link này.").');
  }

  if (!input.affiliateUrl) {
    add('LINK_PRESENT', 'FAIL', 'Bài chưa gắn link affiliate.');
  }
  if (URL_PATTERN.test(body) || URL_PATTERN.test(disclosure)) {
    add('EXTRA_URL', 'FAIL', 'Không đặt link trong nội dung; hệ thống tự thêm link affiliate đã xác minh vào cuối bài.');
  }

  for (const claim of BANNED_CLAIMS) {
    if (claim.pattern.test(folded)) {
      add('BANNED_CLAIM', 'FAIL', `Nội dung có ${claim.label}. Hãy bỏ hoặc nêu thông tin có thể kiểm chứng.`);
    }
  }
  if (SUPERLATIVES.some((p) => p.test(folded))) {
    add('SUPERLATIVE', 'WARN', 'Có so sánh tuyệt đối ("nhất", "số 1"...) khó kiểm chứng; hãy chắc chắn có căn cứ.');
  }

  const amounts = findAmounts(body);
  if (amounts.length > 0) {
    const { currentPrice, currency, priceVerifiedAt } = input.product;
    const priceKnown = currentPrice !== null && currency === 'VND';
    for (const amount of amounts) {
      const severity: Severity = amount.explicitCurrency ? 'FAIL' : 'WARN';
      if (!priceKnown) {
        add('PRICE_CLAIM', severity, `Bài nêu "${amount.raw.trim()}" nhưng sản phẩm chưa có giá VND đã biết để đối chiếu.`);
      } else if (Math.abs(amount.vnd - (currentPrice as number)) > Math.max(1, (currentPrice as number) * 0.005)) {
        add('PRICE_CLAIM', severity, `Giá nêu "${amount.raw.trim()}" (${formatVnd(amount.vnd)}) khác giá sản phẩm ${formatVnd(currentPrice as number)}.`);
      }
    }
    if (priceKnown && priceVerifiedAt && input.now.getTime() - priceVerifiedAt.getTime() > PRICE_STALE_DAYS * DAY_MS) {
      add('PRICE_CLAIM', 'WARN', `Giá sản phẩm được xác minh hơn ${PRICE_STALE_DAYS} ngày trước; hãy kiểm tra lại trước khi đăng.`);
    } else if (priceKnown && !priceVerifiedAt) {
      add('PRICE_CLAIM', 'WARN', 'Giá sản phẩm chưa có thời điểm xác minh; hãy kiểm tra lại trước khi đăng.');
    }
  }
  if (/\b(giam|sale|off)\s*(den|toi|up to)?\s*\d{1,3}\s*%|\b\d{1,3}\s*%\s*(off|giam)\b/.test(folded)) {
    add('DISCOUNT_CLAIM', 'WARN', 'Bài nêu phần trăm giảm giá; hệ thống không có giá gốc để xác minh. Hãy kiểm tra trên trang sản phẩm.');
  }

  let worst = 0;
  for (const other of input.recentBodies) {
    worst = Math.max(worst, similarity(body, other));
  }
  if (worst >= DUPLICATE_FAIL) {
    add('DUPLICATE', 'FAIL', `Nội dung giống ${Math.round(worst * 100)}% một bài gần đây. Hãy viết khác đi.`);
  } else if (worst >= DUPLICATE_WARN) {
    add('DUPLICATE', 'WARN', `Nội dung khá giống (${Math.round(worst * 100)}%) một bài gần đây.`);
  }

  return {
    ok: !findings.some((f) => f.severity === 'FAIL'),
    findings,
    composedText,
    composedLength,
  };
}
