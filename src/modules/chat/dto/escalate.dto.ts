import { IsString, MinLength, MaxLength } from 'class-validator';

export class EscalateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason: string;
}
