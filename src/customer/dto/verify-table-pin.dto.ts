import { IsString, Length } from 'class-validator';

export class VerifyTablePinDto {
  @IsString()
  @Length(4, 6)
  tablePin: string;
}
