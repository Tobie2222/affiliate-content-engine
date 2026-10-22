export interface ScoreInput {
  commissionRate: number | null;
  currentPrice: number | null;
  imageUrl: string | null;
  description: string | null;
  category: string | null;
}

export interface ScoreFactor {
  factor: string;
  points: number;
  max: number;
  note: string;
}

export interface ProductScore {
  /** 0-100. Chỉ tính từ dữ liệu đang có; giá trị chưa biết được 0 điểm và liệt kê ở `missing`. */
  score: number;
  max: 100;
  breakdown: ScoreFactor[];
  missing: string[];
}

const COMMISSION_MAX_POINTS = 50;
/** Mức hoa hồng được tính điểm tối đa (%). Ngưỡng khởi điểm, chưa dựa trên dữ liệu bán hàng. */
const COMMISSION_CAP_RATE = 20;
const MIN_DESCRIPTION_LENGTH = 50;

/**
 * Điểm "đủ dữ liệu và hoa hồng", giải thích được từng phần. KHÔNG phải dự đoán doanh số:
 * hệ thống chưa có dữ liệu bán hàng, lượt xem hay đánh giá nên không dùng các yếu tố đó.
 */
export function scoreProduct(input: ScoreInput): ProductScore {
  const breakdown: ScoreFactor[] = [];
  const missing: string[] = [];

  if (input.commissionRate === null) {
    missing.push('commissionRate');
    breakdown.push({
      factor: 'commission',
      points: 0,
      max: COMMISSION_MAX_POINTS,
      note: 'Chưa biết tỷ lệ hoa hồng.',
    });
  } else {
    const ratio = Math.min(input.commissionRate, COMMISSION_CAP_RATE) / COMMISSION_CAP_RATE;
    breakdown.push({
      factor: 'commission',
      points: Math.round(ratio * COMMISSION_MAX_POINTS),
      max: COMMISSION_MAX_POINTS,
      note: `Hoa hồng ${input.commissionRate}% (tối đa điểm từ ${COMMISSION_CAP_RATE}%).`,
    });
  }

  const flag = (
    factor: string,
    max: number,
    present: boolean,
    presentNote: string,
    missingNote: string,
    missingKey: string,
  ): void => {
    if (!present) missing.push(missingKey);
    breakdown.push({
      factor,
      points: present ? max : 0,
      max,
      note: present ? presentNote : missingNote,
    });
  };

  flag('price', 10, input.currentPrice !== null, 'Có giá.', 'Chưa biết giá.', 'currentPrice');
  flag('image', 15, !!input.imageUrl, 'Có ảnh sản phẩm.', 'Chưa có ảnh sản phẩm.', 'imageUrl');
  flag(
    'description',
    15,
    (input.description?.length ?? 0) >= MIN_DESCRIPTION_LENGTH,
    'Có mô tả đủ dài.',
    `Chưa có mô tả (tối thiểu ${MIN_DESCRIPTION_LENGTH} ký tự).`,
    'description',
  );
  flag('category', 10, !!input.category, 'Có danh mục.', 'Chưa có danh mục.', 'category');

  const score = breakdown.reduce((sum, f) => sum + f.points, 0);
  return { score, max: 100, breakdown, missing };
}
