import { randomBytes } from 'node:crypto';

/** "Công ty Tiếp thị ABC" -> "cong-ty-tiep-thi-abc" (chỉ a-z, 0-9 và dấu gạch ngang). */
export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
}

/** Thêm hậu tố ngẫu nhiên để slug không đụng nhau giữa các tổ chức. */
export function generateOrgSlug(name: string): string {
  const base = slugify(name) || 'org';
  return `${base}-${randomBytes(3).toString('hex')}`;
}
