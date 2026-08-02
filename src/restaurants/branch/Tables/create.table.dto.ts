import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateTableDto {
  @IsString()
  number: string;

  @IsInt()
  @Min(1)
  seats: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
