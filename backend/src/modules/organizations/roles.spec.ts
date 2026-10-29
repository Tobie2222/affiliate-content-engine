import {
  Permission,
  ROLE_PERMISSIONS,
  Role,
  canManageRole,
  hasPermission,
  wouldRemoveLastOwner,
} from './roles';
import { generateOrgSlug, slugify } from './slug';

const ALL_ROLES = Object.values(Role);

describe('quyền theo vai trò', () => {
  it('OWNER có mọi quyền', () => {
    for (const p of Object.values(Permission)) {
      expect(hasPermission(Role.Owner, p)).toBe(true);
    }
  });

  it('chỉ OWNER có quyền quản trị tổ chức', () => {
    for (const role of ALL_ROLES) {
      expect(hasPermission(role, Permission.OrgManage)).toBe(role === Role.Owner);
    }
  });

  it('chỉ OWNER và ADMIN quản lý thành viên', () => {
    for (const role of ALL_ROLES) {
      expect(hasPermission(role, Permission.MembersManage)).toBe(
        role === Role.Owner || role === Role.Admin,
      );
    }
  });

  it('lên lịch đăng: OWNER, ADMIN, CONTENT_EDITOR; kết nối tài khoản: OWNER, ADMIN; ai cũng xem được tài khoản', () => {
    for (const role of ALL_ROLES) {
      expect(hasPermission(role, Permission.PublishManage)).toBe(
        role === Role.Owner || role === Role.Admin || role === Role.ContentEditor,
      );
      expect(hasPermission(role, Permission.SocialManage)).toBe(role === Role.Owner || role === Role.Admin);
      expect(hasPermission(role, Permission.SocialRead)).toBe(true);
    }
  });

  it('nhập số liệu: OWNER, ADMIN, ANALYST', () => {
    for (const role of ALL_ROLES) {
      expect(hasPermission(role, Permission.AnalyticsWrite)).toBe(role === Role.Owner || role === Role.Admin || role === Role.Analyst);
    }
  });

  it('quyền duyệt bài chỉ thuộc OWNER, ADMIN, REVIEWER', () => {
    for (const role of ALL_ROLES) {
      expect(hasPermission(role, Permission.ContentReview)).toBe(
        role === Role.Owner || role === Role.Admin || role === Role.Reviewer,
      );
    }
  });

  it('CONTENT_EDITOR soạn được nhưng không duyệt được', () => {
    expect(hasPermission(Role.ContentEditor, Permission.ContentWrite)).toBe(true);
    expect(hasPermission(Role.ContentEditor, Permission.ContentReview)).toBe(false);
  });

  it('REVIEWER duyệt được nhưng không soạn được', () => {
    expect(hasPermission(Role.Reviewer, Permission.ContentReview)).toBe(true);
    expect(hasPermission(Role.Reviewer, Permission.ContentWrite)).toBe(false);
  });

  it('ANALYST chỉ đọc và xem số liệu, không điều khiển văn phòng AI', () => {
    expect(hasPermission(Role.Analyst, Permission.AnalyticsRead)).toBe(true);
    expect(hasPermission(Role.Analyst, Permission.OfficeControl)).toBe(false);
    expect(hasPermission(Role.Analyst, Permission.ContentWrite)).toBe(false);
  });

  it('danh mục sản phẩm: mọi vai trò xem được; chỉ OWNER, ADMIN, CONTENT_EDITOR sửa được', () => {
    for (const role of ALL_ROLES) {
      expect(hasPermission(role, Permission.CatalogRead)).toBe(true);
      expect(hasPermission(role, Permission.CatalogWrite)).toBe(
        role === Role.Owner || role === Role.Admin || role === Role.ContentEditor,
      );
    }
  });

  it('xác minh link affiliate chỉ thuộc OWNER, ADMIN, REVIEWER (người soạn không tự xác minh)', () => {
    for (const role of ALL_ROLES) {
      expect(hasPermission(role, Permission.LinksVerify)).toBe(
        role === Role.Owner || role === Role.Admin || role === Role.Reviewer,
      );
    }
  });

  it('media: mọi vai trò xem được; OWNER, ADMIN, CONTENT_EDITOR thêm/sửa; OWNER, ADMIN, REVIEWER duyệt giấy phép', () => {
    for (const role of ALL_ROLES) {
      expect(hasPermission(role, Permission.MediaRead)).toBe(true);
      expect(hasPermission(role, Permission.MediaWrite)).toBe(
        role === Role.Owner || role === Role.Admin || role === Role.ContentEditor,
      );
      expect(hasPermission(role, Permission.MediaReview)).toBe(
        role === Role.Owner || role === Role.Admin || role === Role.Reviewer,
      );
    }
  });

  it('mọi vai trò đều xem được văn phòng AI', () => {
    for (const role of ALL_ROLES) {
      expect(hasPermission(role, Permission.OfficeRead)).toBe(true);
    }
  });

  it('vai trò không tồn tại không có quyền nào', () => {
    expect(hasPermission('HACKER' as Role, Permission.OfficeRead)).toBe(false);
  });

  it('bảng quyền không chứa quyền trùng lặp', () => {
    for (const role of ALL_ROLES) {
      const list = ROLE_PERMISSIONS[role];
      expect(new Set(list).size).toBe(list.length);
    }
  });
});

describe('canManageRole', () => {
  it('OWNER quản lý được mọi vai trò', () => {
    for (const target of ALL_ROLES) {
      expect(canManageRole(Role.Owner, target)).toBe(true);
    }
  });

  it('ADMIN chỉ quản lý được vai trò thấp hơn', () => {
    expect(canManageRole(Role.Admin, Role.ContentEditor)).toBe(true);
    expect(canManageRole(Role.Admin, Role.Reviewer)).toBe(true);
    expect(canManageRole(Role.Admin, Role.Analyst)).toBe(true);
    expect(canManageRole(Role.Admin, Role.Admin)).toBe(false);
    expect(canManageRole(Role.Admin, Role.Owner)).toBe(false);
  });

  it('các vai trò còn lại không quản lý được ai', () => {
    for (const actor of [Role.ContentEditor, Role.Reviewer, Role.Analyst]) {
      for (const target of ALL_ROLES) {
        expect(canManageRole(actor, target)).toBe(false);
      }
    }
  });
});

describe('wouldRemoveLastOwner', () => {
  it('gỡ hoặc hạ cấp OWNER duy nhất bị chặn', () => {
    expect(wouldRemoveLastOwner(Role.Owner, null, 1)).toBe(true);
    expect(wouldRemoveLastOwner(Role.Owner, Role.Admin, 1)).toBe(true);
  });

  it('có OWNER khác thì được phép', () => {
    expect(wouldRemoveLastOwner(Role.Owner, null, 2)).toBe(false);
    expect(wouldRemoveLastOwner(Role.Owner, Role.Admin, 2)).toBe(false);
  });

  it('giữ nguyên OWNER thì không phải mất OWNER', () => {
    expect(wouldRemoveLastOwner(Role.Owner, Role.Owner, 1)).toBe(false);
  });

  it('thành viên không phải OWNER thì không liên quan', () => {
    expect(wouldRemoveLastOwner(Role.Admin, null, 1)).toBe(false);
  });
});

describe('slug', () => {
  it('bỏ dấu tiếng Việt và chuẩn hóa', () => {
    expect(slugify('Công ty Tiếp thị ABC')).toBe('cong-ty-tiep-thi-abc');
    expect(slugify('Đặng  Văn   Đức')).toBe('dang-van-duc');
  });

  it('bỏ ký tự đặc biệt ở đầu cuối', () => {
    expect(slugify('  --Shop #1!!  ')).toBe('shop-1');
  });

  it('chuỗi toàn ký tự đặc biệt cho ra rỗng; slug tổ chức có giá trị dự phòng', () => {
    expect(slugify('!!!')).toBe('');
    expect(/^org-[0-9a-f]{6}$/.test(generateOrgSlug('!!!'))).toBe(true);
  });

  it('slug tổ chức có hậu tố ngẫu nhiên, hai lần gọi khác nhau', () => {
    const a = generateOrgSlug('Demo');
    const b = generateOrgSlug('Demo');
    expect(/^demo-[0-9a-f]{6}$/.test(a)).toBe(true);
    expect(a === b).toBe(false);
  });

  it('cắt tên quá dài mà không để lại dấu gạch cuối', () => {
    const slug = slugify('a '.repeat(100));
    expect(slug.length <= 60).toBe(true);
    expect(slug.endsWith('-')).toBe(false);
  });
});
