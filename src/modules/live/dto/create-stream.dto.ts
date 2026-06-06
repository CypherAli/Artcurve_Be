import { IsString, IsNotEmpty, MaxLength, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateStreamDto {
  @ApiProperty({ example: 'Painting session — Pale Architecture' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string;

  @ApiProperty({ example: 'Painting' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  category: string;

  @ApiPropertyOptional({ example: '$PALE' })
  @IsString()
  @IsOptional()
  @MaxLength(32)
  artwork_ticker?: string;
}
