import {
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsUUID,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreatePaymentDto {
  @IsUUID()
  orderId: string;

  /**
   * CASH — till cash (PAID).
   * CARD — Stripe Terminal only (PENDING → webhook).
   * CARD_MANUAL — explicit honor-system card (PAID).
   * ONLINE — Checkout (PENDING → webhook).
   */
  @IsIn(['CASH', 'CARD', 'CARD_MANUAL', 'ONLINE'])
  method: 'CASH' | 'CARD' | 'CARD_MANUAL' | 'ONLINE';

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
}

/** Explicit till operation: record unpaid CASH (settle later via markPaid). */
export class CreatePendingCashDto {
  @IsUUID()
  orderId: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  tipAmount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount?: number;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  orderItemIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  seatNumbers?: number[];
}
