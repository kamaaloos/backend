import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { AuthService } from './auth.service';
import { parseCookieHeader, REFRESH_COOKIE } from './cookie.util';
import { LoginDto } from './dto/login.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  async login(
    @Body() loginDto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(loginDto);
    this.authService.attachRefreshCookie(res, result.refreshToken);
    return {
      access_token: result.access_token,
      user: result.user,
      expires_in: result.expires_in,
    };
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const raw = parseCookieHeader(req.headers.cookie, REFRESH_COOKIE);
    if (!raw) {
      throw new UnauthorizedException('Missing refresh token');
    }
    const result = await this.authService.refresh(raw);
    this.authService.attachRefreshCookie(res, result.refreshToken);
    return {
      access_token: result.access_token,
      user: result.user,
      expires_in: result.expires_in,
    };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const raw = parseCookieHeader(req.headers.cookie, REFRESH_COOKIE);
    await this.authService.logout(raw);
    this.authService.clearRefreshCookie(res);
    return { ok: true };
  }
}
