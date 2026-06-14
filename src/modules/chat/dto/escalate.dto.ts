import { IsString, IsUUID, MinLength, MaxLength } from 'class-validator';

export class EscalateDto {
  @IsUUID()
  session_id: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason: string;
}
