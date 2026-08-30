import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateMenuItemDto {
  @IsOptional()
  @IsUUID()
  restaurantId?: string;

  @IsUUID()
  categoryId: string;

  @IsString()
  @MaxLength(150)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  price: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  imageUrl?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsBoolean()
  available?: boolean;
}
