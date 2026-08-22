import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import type { Table } from '@prisma/client';

import { verifyOrderPin } from '../tables/order-pin.util';
import {
  TABLE_PRESENCE_COOKIE,
  TABLE_PRESENCE_PATH,
  endOfDayInTimezone,
  isPresenceValidForTable,
  parseTablePresenceCookie,
  signTablePresenceToken,
} from './table-presence.util';

type TableWithBranch = Table & {
  branch: { restaurant: { timezone: string } };
};

@Injectable()
export class TablePresenceService {
  constructor(private readonly config: ConfigService) {}

  presenceStatus(table: Table, cookieHeader: string | undefined) {
    if (!table.orderPinHash) {
      return { verified: false, pinConfigured: false };
    }
    const payload = parseTablePresenceCookie(cookieHeader, this.secret());
    const verified = isPresenceValidForTable(
      payload,
      table.id,
      table.orderPinVersion,
    );
    return { verified, pinConfigured: true };
  }

  async verifyPin(
    table: TableWithBranch,
    pin: string,
    res: Response,
  ): Promise<{ ok: true }> {
    this.assertPinConfigured(table);
    const valid = await verifyOrderPin(pin, table.orderPinHash);
    if (!valid) {
      throw new UnauthorizedException(
        'Invalid table PIN. Check the number on your table card.',
      );
    }
    this.attachPresenceCookie(res, table);
    return { ok: true };
  }

  async assertCanOrder(
    table: TableWithBranch,
    cookieHeader: string | undefined,
    pin: string | undefined,
    res: Response,
  ): Promise<void> {
    this.assertPinConfigured(table);

    const payload = parseTablePresenceCookie(cookieHeader, this.secret());
    if (isPresenceValidForTable(payload, table.id, table.orderPinVersion)) {
      return;
    }

    if (pin) {
      const valid = await verifyOrderPin(pin, table.orderPinHash);
      if (valid) {
        this.attachPresenceCookie(res, table);
        return;
      }
      throw new UnauthorizedException(
        'Invalid table PIN. Check the number on your table card.',
      );
    }

    throw new UnauthorizedException(
      'Enter the table PIN from your table card to order.',
    );
  }

  attachPresenceCookie(res: Response, table: TableWithBranch) {
    const timezone = table.branch.restaurant.timezone || 'Europe/Helsinki';
    const exp = endOfDayInTimezone(timezone).getTime();
    const token = signTablePresenceToken(
      {
        tableId: table.id,
        pinVersion: table.orderPinVersion,
        exp,
      },
      this.secret(),
    );
    const maxAge = Math.max(0, exp - Date.now());
    res.cookie(TABLE_PRESENCE_COOKIE, token, this.cookieOptions(maxAge));
  }

  private assertPinConfigured(table: Table) {
    if (!table.orderPinHash) {
      throw new ServiceUnavailableException(
        'Table ordering is not configured yet. Ask staff to rotate the table QR.',
      );
    }
  }

  private cookieOptions(maxAge: number) {
    const secure = this.useSecureCookies();
    return {
      httpOnly: true,
      secure,
      sameSite: secure ? ('none' as const) : ('lax' as const),
      path: TABLE_PRESENCE_PATH,
      maxAge,
    };
  }

  private useSecureCookies(): boolean {
    const flag = this.config.get<string>('COOKIE_SECURE');
    if (flag === '0' || flag === 'false') return false;
    if (flag === '1' || flag === 'true') return true;
    return this.config.get('NODE_ENV') === 'production';
  }

  private secret(): string {
    const dedicated = this.config.get<string>('TABLE_PRESENCE_SECRET')?.trim();
    if (dedicated) return dedicated;

    const jwt = this.config.get<string>('JWT_SECRET')?.trim();
    const isProd = this.config.get('NODE_ENV') === 'production';
    if (isProd) {
      if (!jwt) {
        throw new ServiceUnavailableException(
          'TABLE_PRESENCE_SECRET (or JWT_SECRET) must be set in production',
        );
      }
      return jwt;
    }

    return jwt || 'dev-table-presence-secret';
  }
}
