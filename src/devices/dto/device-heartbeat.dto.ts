import { IsOptional, IsString, MaxLength } from 'class-validator';

export class DeviceHeartbeatDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  appVersion?: string;
}
