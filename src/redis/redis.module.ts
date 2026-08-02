import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { RedisService } from './redis.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: RedisService,
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => {
        const service = new RedisService(config);
        await service.connect();
        return service;
      },
    },
  ],
  exports: [RedisService],
})
export class RedisModule {}
