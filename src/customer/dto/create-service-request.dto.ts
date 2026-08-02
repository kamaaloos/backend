import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ServiceRequestType } from '@prisma/client';

export class CreateServiceRequestDto {
  @IsEnum(ServiceRequestType)
  type: ServiceRequestType;

  @IsOptional()
  @IsUUID()
  orderId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
