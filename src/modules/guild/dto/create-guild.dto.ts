import { IsString, IsNotEmpty, IsOptional, MaxLength, IsInt, Min, Max, IsIn } from 'class-validator';
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

  @ApiPropertyOptional({ description: 'Số thành viên tối đa (8–100)', default: 30 })
  @IsOptional()
  @IsInt()
  @Min(8)
  @Max(100)
  max_members?: number;

  @ApiPropertyOptional({ description: "Chế độ duyệt: 'auto' | 'manual'", default: 'auto' })
  @IsOptional()
  @IsIn(['auto', 'manual'])
  acceptance?: 'auto' | 'manual';
}
