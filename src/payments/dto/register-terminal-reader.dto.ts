import { IsString, MinLength } from 'class-validator';

export class RegisterTerminalReaderDto {
  /** Code shown on the physical reader during registration. */
  @IsString()
  @MinLength(4)
  registrationCode: string;

  @IsString()
  @MinLength(1)
  label: string;
}
