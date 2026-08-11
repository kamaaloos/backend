import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { OrderMode } from '@prisma/client';

import { Type } from 'class-transformer';
import { CreateOrderItemDto } from './create-order-item.dto';

export class CreateOrderDto {
  /** Defaults to DINE_IN. WALK_IN assigns a queue number and waits for payment. */
  @IsOptional()
  @IsEnum(OrderMode)
  mode?: OrderMode;

  /** Required for WALK_IN when the user is not branch-scoped (admin/owner). */
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsUUID()
  tableId?: string;

  @IsOptional()
  @IsString()
  customerName?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items: CreateOrderItemDto[];
}
