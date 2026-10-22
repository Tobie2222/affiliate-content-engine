import type { Request } from 'express';
import type { Role } from '../organizations/roles';

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AuthenticatedRequest extends Request {
  user?: { id: string };
  membership?: { organizationId: string; memberId: string; role: Role };
}

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  /** Thời hạn access token (giây). */
  expiresIn: number;
  user: { id: string; email: string; displayName: string };
}
