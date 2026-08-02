import {
  ArrayUnique,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsUUID,
  Min,
} from 'class-validator';
import { PaymentStatus } from '@prisma/client';
import { Type } from 'class-transformer';

export class CreatePaymentDto {
  @IsUUID()
  orderId: string;

  @IsIn(['CASH', 'CARD', 'ONLINE'])
  method: 'CASH' | 'CARD' | 'ONLINE';

  /** Optional tip (>= 0). Charged total = cover + tip. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  tipAmount?: number;

  /**
   * Total charged (cover toward order + tip).
   * Defaults to remaining balance + tip when omitted.
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount?: number;

  /** Split by line items (mutually exclusive with seatNumbers). */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  orderItemIds?: string[];

  /** Split by seat numbers (mutually exclusive with orderItemIds). */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  seatNumbers?: number[];

  @IsOptional()
  @IsEnum(PaymentStatus)
  status?: PaymentStatus;
}
