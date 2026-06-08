import { IsOptional, IsString, MaxLength, IsUrl, Matches, IsIn } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateProfileDto {
  @ApiPropertyOptional({
    description: 'Tên hiển thị (username)',
    example: 'whale_artist',
    maxLength: 50,
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  username?: string;

  @ApiPropertyOptional({
    description: 'Bio / giới thiệu bản thân',
    example: 'Digital artist & early DeFi collector',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  bio?: string;

  @ApiPropertyOptional({
    description: 'URL ảnh đại diện (HTTPS hoặc IPFS)',
    example: 'https://ipfs.io/ipfs/Qm...',
  })
  @IsOptional()
  @IsUrl({ protocols: ['https', 'ipfs'] }, { message: 'avatar_url phải là URL hợp lệ' })
  avatar_url?: string;

  @ApiPropertyOptional({
    description: 'Twitter/X handle (không cần @)',
    example: 'artcurve_whale',
    maxLength: 50,
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Matches(/^[A-Za-z0-9_]{1,50}$/, {
    message: 'twitter_handle chỉ được chứa chữ, số, underscore',
  })
  twitter_handle?: string;

  @ApiPropertyOptional({
    description: 'Ngôn ngữ giao diện (BCP-47 locale code)',
    example: 'en',
    enum: ['en', 'vi', 'fr', 'ja', 'es', 'zh', 'ko', 'de', 'ar', 'pt'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['en', 'vi', 'fr', 'ja', 'es', 'zh', 'ko', 'de', 'ar', 'pt'], {
    message: 'language không hợp lệ',
  })
  language?: string;
}
