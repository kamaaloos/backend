import {
  IsArray,
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

const HEX = /^#[0-9A-Fa-f]{6}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class CreateRestaurantDto {
  @IsString()
  @MaxLength(100)
  name: string;

  /** Optional public subdomain slug (e.g. alhuda → alhuda.maylesoft.com). */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Matches(SLUG, {
    message: 'slug must be lowercase letters, numbers, and hyphens',
  })
  slug?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsEmail()
  email: string;

  @IsString()
  phone: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  logoUrl?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v != null && v !== '')
  @Matches(HEX, { message: 'brandAccent must be a hex color like #c9a86a' })
  brandAccent?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v != null && v !== '')
  @Matches(HEX, { message: 'brandButton must be a hex color like #234128' })
  brandButton?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v != null && v !== '')
  @Matches(HEX, { message: 'brandPaper must be a hex color like #f8f5ef' })
  brandPaper?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  brandBackgroundUrl?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(1000, { each: true })
  brandBackgroundUrls?: string[] | null;

  @IsOptional()
  @ValidateIf((_, v) => v != null && v !== '')
  @Matches(HEX, { message: 'qrFrameColor must be a hex color like #E31B23' })
  qrFrameColor?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v != null && v !== '')
  @Matches(HEX, { message: 'qrModuleColor must be a hex color like #2F6BFF' })
  qrModuleColor?: string | null;
}
