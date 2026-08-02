import { UserRole } from '@prisma/client';

export interface JwtPayload {
  /** User id (JWT subject). Prefer this in new code. */
  sub: string;
  /** Alias of sub — set by JwtStrategy for compatibility. */
  id: string;
  email: string;
  role: UserRole;
  restaurantId: string | null;
  branchId: string | null;
}
