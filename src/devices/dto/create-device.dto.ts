import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { DeviceType } from '@prisma/client';

export class CreateDeviceDto {
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsString()
  @MaxLength(100)
  name: string;

  @IsEnum(DeviceType)
  deviceType: DeviceType;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  appVersion?: string;
}
