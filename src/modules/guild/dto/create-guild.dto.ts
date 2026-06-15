import { IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateGuildDto {
  @ApiProperty({ description: 'Guild name', maxLength: 64 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  name: string;

  @ApiPropertyOptional({ description: 'Guild description', maxLength: 255 })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  description?: string;

  @ApiProperty({ description: 'Guild focus / category', maxLength: 32 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  focus: string;
}
