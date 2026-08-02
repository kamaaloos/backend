import { Global, Module } from '@nestjs/common';
import { AuthorizationService } from './authorization/authorization.service';
import { PrismaModule } from '../prisma/prisma.module';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [AuthorizationService],
  exports: [AuthorizationService],
})
export class CommonModule {}
