import { IsString, Length, Matches } from 'class-validator';

export class PairDeviceDto {
  /** One-time pairing code from Admin QR (not the long-lived device token). */
  @IsString()
  @Length(6, 12)
  @Matches(/^[A-Z0-9]+$/i, {
    message: 'pairing code must be alphanumeric',
  })
  code: string;
}
