import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser>(
    err: Error | null,
    user: TUser,
    info: Error | undefined,
    _context: ExecutionContext,
  ): TUser {
    if (err || !user) {
      throw (
        err ??
        new UnauthorizedException(
          info?.message === 'jwt expired'
            ? 'Token expired — refresh the session or sign in again'
            : 'Invalid or missing token — sign in again',
        )
      );
    }
    return user;
  }
}
