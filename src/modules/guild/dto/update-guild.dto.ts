import { IsString, IsOptional, MaxLength, IsInt, Min, Max, IsIn } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateGuildDto {
  @ApiPropertyOptional({ maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  name?: string;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @ApiPropertyOptional({ maxLength: 32 })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  focus?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(8)
  @Max(100)
  max_members?: number;

  @ApiPropertyOptional({ enum: ['auto', 'manual'] })
  @IsOptional()
  @IsIn(['auto', 'manual'])
  acceptance?: 'auto' | 'manual';
}
