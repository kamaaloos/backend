import { UserRole } from '@prisma/client';

export const ROLE_PERMISSIONS: Record<UserRole, UserRole[]> = {
  [UserRole.PLATFORM_ADMIN]: [
    UserRole.RESTAURANT_OWNER,
    UserRole.BRANCH_MANAGER,
    UserRole.WAITER,
    UserRole.CHEF,
    UserRole.CASHIER,
    UserRole.ACCOUNTANT,
  ],

  [UserRole.RESTAURANT_OWNER]: [
    UserRole.BRANCH_MANAGER,
    UserRole.WAITER,
    UserRole.CHEF,
    UserRole.CASHIER,
    UserRole.ACCOUNTANT,
  ],

  [UserRole.BRANCH_MANAGER]: [UserRole.WAITER, UserRole.CHEF, UserRole.CASHIER],

  [UserRole.WAITER]: [],
  [UserRole.CHEF]: [],
  [UserRole.CASHIER]: [],
  [UserRole.ACCOUNTANT]: [],
};
