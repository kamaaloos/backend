import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateTableDto } from './create-table.dto';

export class UpdateTableDto extends PartialType(
  OmitType(CreateTableDto, ['branchId'] as const),
) {}
