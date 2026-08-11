import { IsBoolean } from 'class-validator';

export class SetMenuItemAvailabilityDto {
  @IsBoolean()
  available: boolean;
}
