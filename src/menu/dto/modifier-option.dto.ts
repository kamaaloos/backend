import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateModifierOptionStandaloneDto {
  @IsUUID()
  groupId: string;

  @IsString()
  @MaxLength(100)
  name: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  priceDelta?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  displayOrder?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateModifierOptionDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  priceDelta?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  displayOrder?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
