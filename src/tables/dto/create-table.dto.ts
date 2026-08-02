import { IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class CreateTableDto {
  @IsString()
  number: string;

  @IsInt()
  @Min(1)
  seats: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;
}
