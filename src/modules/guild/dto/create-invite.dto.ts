import { IsOptional, IsInt, Min, Max } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CreateInviteDto {
  @ApiPropertyOptional({ description: 'Max uses (null = unlimited)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  max_uses?: number;

  @ApiPropertyOptional({ description: 'Expires in hours (null = never)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(720)
  expires_in_hours?: number;
}
