export const jwtConstants = {
  secret:
    process.env.JWT_SECRET ??
    'CHANGE_THIS_TO_A_LONG_RANDOM_SECRET_IN_PRODUCTION',
};
