import { IsIn } from 'class-validator';

export class PayWalkInOrderDto {
  @IsIn(['CASH', 'CARD_MANUAL', 'ONLINE'])
  method: 'CASH' | 'CARD_MANUAL' | 'ONLINE';
}
