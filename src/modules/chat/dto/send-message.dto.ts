import { IsString, IsOptional, IsUUID, MinLength, MaxLength } from 'class-validator';

export class SendMessageDto {
  @IsOptional()
  @IsUUID()
  session_id?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  content: string;
}
