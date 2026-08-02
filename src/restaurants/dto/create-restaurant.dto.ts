import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateRestaurantDto {
  @IsString()
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsEmail()
  email: string;

  @IsString()
  phone: string;
}
