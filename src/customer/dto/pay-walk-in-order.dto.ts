import { IsIn } from 'class-validator';

export class PayWalkInOrderDto {
  @IsIn(['CASH', 'CARD', 'ONLINE'])
  method: 'CASH' | 'CARD' | 'ONLINE';
}
