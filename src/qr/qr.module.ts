import { Module } from '@nestjs/common';

import { QrController } from './qr.controller';

/** Serves 410 Gone for legacy `/api/qr/*` paths. */
@Module({
  controllers: [QrController],
})
export class QrModule {}
