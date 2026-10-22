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
}

const P = Permission;

export const ROLE_PERMISSIONS: Readonly<Record<Role, ReadonlyArray<Permission>>> = {
  [Role.Owner]: Object.values(Permission),
  [Role.Admin]: [
    P.MembersManage, P.OfficeRead, P.OfficeControl,
    P.ContentRead, P.ContentWrite, P.ContentReview, P.AnalyticsRead,
  ],
  [Role.ContentEditor]: [P.OfficeRead, P.ContentRead, P.ContentWrite],
  [Role.Reviewer]: [P.OfficeRead, P.ContentRead, P.ContentReview],
  [Role.Analyst]: [P.OfficeRead, P.ContentRead, P.AnalyticsRead],
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
