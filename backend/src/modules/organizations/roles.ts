export enum Role {
  Owner = 'OWNER',
  Admin = 'ADMIN',
  ContentEditor = 'CONTENT_EDITOR',
  Reviewer = 'REVIEWER',
  Analyst = 'ANALYST',
}

export enum Permission {
  OrgManage = 'org.manage',
  MembersManage = 'members.manage',
  OfficeRead = 'office.read',
  OfficeControl = 'office.control',
  ContentRead = 'content.read',
  ContentWrite = 'content.write',
  ContentReview = 'content.review',
  AnalyticsRead = 'analytics.read',
  CatalogRead = 'catalog.read',
  CatalogWrite = 'catalog.write',
  /** Xác minh link affiliate do người dùng tự nhập (bước kiểm tra của con người). */
  LinksVerify = 'links.verify',
  MediaRead = 'media.read',
  MediaWrite = 'media.write',
  /** Xác nhận hoặc từ chối giấy phép media (bước kiểm tra của con người). */
  MediaReview = 'media.review',
  SocialRead = 'social.read',
  /** Kết nối / ngắt kết nối tài khoản mạng xã hội. */
  SocialManage = 'social.manage',
  /** Lên lịch, hủy lịch và thử lại việc đăng bài đã được duyệt. */
  PublishManage = 'publish.manage',
}

const P = Permission;

export const ROLE_PERMISSIONS: Readonly<Record<Role, ReadonlyArray<Permission>>> = {
  [Role.Owner]: Object.values(Permission),
  [Role.Admin]: [
    P.MembersManage, P.OfficeRead, P.OfficeControl,
    P.ContentRead, P.ContentWrite, P.ContentReview, P.AnalyticsRead,
    P.CatalogRead, P.CatalogWrite, P.LinksVerify,
    P.MediaRead, P.MediaWrite, P.MediaReview,
    P.SocialRead, P.SocialManage, P.PublishManage,
  ],
  [Role.ContentEditor]: [
    P.OfficeRead, P.ContentRead, P.ContentWrite, P.CatalogRead, P.CatalogWrite,
    P.MediaRead, P.MediaWrite, P.SocialRead, P.PublishManage,
  ],
  [Role.Reviewer]: [
    P.OfficeRead, P.ContentRead, P.ContentReview, P.CatalogRead, P.LinksVerify,
    P.MediaRead, P.MediaReview, P.SocialRead,
  ],
  [Role.Analyst]: [P.OfficeRead, P.ContentRead, P.AnalyticsRead, P.CatalogRead, P.MediaRead, P.SocialRead],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

const ADMIN_MANAGEABLE: ReadonlyArray<Role> = [
  Role.ContentEditor,
  Role.Reviewer,
  Role.Analyst,
];

/**
 * Người có vai trò `actor` có được cấp/đổi/gỡ một thành viên mang vai trò `target` không.
 * OWNER quản lý mọi vai trò; ADMIN chỉ quản lý các vai trò thấp hơn (không đụng OWNER, ADMIN).
 */
export function canManageRole(actor: Role, target: Role): boolean {
  if (actor === Role.Owner) {
    return true;
  }
  if (actor === Role.Admin) {
    return ADMIN_MANAGEABLE.includes(target);
  }
  return false;
}

/** Thao tác có làm tổ chức mất OWNER cuối cùng không (newRole = null nghĩa là gỡ thành viên). */
export function wouldRemoveLastOwner(
  currentRole: Role,
  newRole: Role | null,
  ownerCount: number,
): boolean {
  return currentRole === Role.Owner && newRole !== Role.Owner && ownerCount <= 1;
}
