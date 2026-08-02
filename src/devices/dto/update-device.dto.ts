import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { DeviceStatus, DeviceType } from '@prisma/client';

export class UpdateDeviceDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsEnum(DeviceType)
  deviceType?: DeviceType;

  @IsOptional()
  @IsEnum(DeviceStatus)
  status?: DeviceStatus;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  appVersion?: string;
}
