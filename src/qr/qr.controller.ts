import { Controller, Get, GoneException, Param, Post } from '@nestjs/common';

/**
 * Legacy QR API — fully retired. Use `/api/customer/:token/*`.
 */
@Controller('qr')
export class QrController {
  @Get(':token')
  getMenu(@Param('token') token: string): never {
    throw new GoneException(
      `Legacy QR menu is retired. Use GET /api/customer/${token}/menu instead.`,
    );
  }

  @Post(':token/orders')
  createOrder(@Param('token') token: string): never {
    throw new GoneException(
      `Legacy QR ordering is retired. Use POST /api/customer/${token}/orders instead.`,
    );
  }
}
