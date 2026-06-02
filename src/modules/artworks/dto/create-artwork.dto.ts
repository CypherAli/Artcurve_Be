import {
  IsString,
  IsNotEmpty,
  IsOptional,
  MaxLength,
  MinLength,
  Matches,
  IsUrl,
  IsIn,
  IsNumberString,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArtworkStatus, ARTWORK_CATEGORIES, CurveType } from '../entities/artwork.entity';

// ── Allowed status transitions ────────────────────────────────────────────────
const ALLOWED_STATUS_TRANSITIONS = [
  ArtworkStatus.AI_MODERATING,
  ArtworkStatus.ACTIVE,
  ArtworkStatus.TARGET_REACHED,
  ArtworkStatus.GRADUATED,
] as const;

// ─── CreateArtworkDto ─────────────────────────────────────────────────────────

export class CreateArtworkDto {
  @ApiProperty({
    description: 'Tên tác phẩm nghệ thuật',
    example: 'Dissolution Study III',
    minLength: 3,
    maxLength: 200,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional({
    description: 'Mô tả tác phẩm',
    example: 'Fractionalized into 100,000 shares on Base L2',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({
    description: 'IPFS URI chứa metadata JSON (có thể upload sau)',
    example: 'ipfs://QmXyz.../metadata.json',
  })
  @IsOptional()
  @IsUrl({ protocols: ['ipfs', 'https'] }, { message: 'ipfs_metadata_uri phải là URL hợp lệ' })
  ipfs_metadata_uri?: string;

  @ApiProperty({
    description: 'Tổng số share phát hành — DECIMAL(18,8) string để tránh JS float precision',
    example: '100000.00000000',
    pattern: '^\\d+(\\.\\d{1,8})?$',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d+(\.\d{1,8})?$/, {
    message: 'target_cap phải là số thập phân dương, tối đa 8 chữ số thập phân',
  })
  target_cap: string;

  /**
   * Token ticker — ký hiệu ngắn của token trên marketplace.
   * Format: $ + 1-6 chữ hoa (ví dụ: $PALE, $BLOOM, $THRESH).
   * Auto-generate từ title nếu không truyền.
   * UNIQUE constraint trên DB — backend trả 400 nếu trùng.
   */
  @ApiPropertyOptional({
    description: 'Token ticker — $ + 1-6 chữ hoa, unique trên platform',
    example: '$DISSOL',
    pattern: '^\\$[A-Z]{1,6}$',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\$[A-Z]{1,6}$/, {
    message: 'ticker phải có format $LETTERS ($ + 1-6 chữ hoa, ví dụ $PALE)',
  })
  ticker?: string;

  /**
   * Danh mục nghệ thuật — dùng để lọc trên marketplace.
   */
  @ApiPropertyOptional({
    description: 'Danh mục tác phẩm',
    enum: ARTWORK_CATEGORIES,
    example: 'Digital',
  })
  @IsOptional()
  @IsIn(ARTWORK_CATEGORIES, {
    message: `category phải là một trong: ${ARTWORK_CATEGORIES.join(', ')}`,
  })
  category?: string;

  /**
   * Phần trăm royalty cho creator (0-10%).
   * DECIMAL(5,2) string — ví dụ "5.00" = 5%.
   */
  @ApiPropertyOptional({
    description: 'Creator royalty % — 0 đến 10',
    example: '5.00',
    default: '5.00',
    pattern: '^\\d+(\\.\\d{1,2})?$',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/, { message: 'royalty_pct phải là số 0-10, tối đa 2 chữ số thập phân' })
  royalty_pct?: string;

  /**
   * Loại bonding curve — quyết định hình dạng đường giá AMM.
   * linear | quadratic | exponential
   */
  @ApiPropertyOptional({
    description: 'Loại bonding curve',
    enum: CurveType,
    example: CurveType.QUADRATIC,
    default: CurveType.QUADRATIC,
  })
  @IsOptional()
  @IsIn(Object.values(CurveType), {
    message: `curve_type phải là: ${Object.values(CurveType).join(', ')}`,
  })
  curve_type?: CurveType;

  /**
   * Giá khởi điểm mỗi token (ETH).
   * DECIMAL(18,8) string — ví dụ "0.00100000" = 0.001 ETH.
   */
  @ApiPropertyOptional({
    description: 'Giá khởi điểm mỗi token (ETH)',
    example: '0.00100000',
    default: '0.00100000',
    pattern: '^\\d+(\\.\\d{1,8})?$',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d+(\.\d{1,8})?$/, { message: 'init_price phải là số thập phân dương, tối đa 8 chữ số thập phân' })
  init_price?: string;
}

// ─── UpdateArtworkStatusDto ───────────────────────────────────────────────────

export class UpdateArtworkStatusDto {
  @ApiProperty({
    description: 'Trạng thái mới trong state machine lifecycle',
    enum: ALLOWED_STATUS_TRANSITIONS,
    example: ArtworkStatus.ACTIVE,
  })
  @IsIn(ALLOWED_STATUS_TRANSITIONS, {
    message: `status phải là một trong: ${ALLOWED_STATUS_TRANSITIONS.join(', ')}`,
  })
  status: ArtworkStatus;

  @ApiPropertyOptional({
    description: 'Địa chỉ smart contract đã deploy — bắt buộc khi status = ACTIVE',
    example: '0xAbCd1234567890AbCd1234567890AbCd12345678',
    pattern: '^0x[0-9a-fA-F]{40}$',
  })
  @IsOptional()
  @IsString()
  @Matches(/^0x[0-9a-fA-F]{40}$/, {
    message: 'contract_address phải đúng format Ethereum (0x + 40 hex chars)',
  })
  contract_address?: string;

  @ApiPropertyOptional({
    description: 'IPFS URI chứa metadata JSON — bắt buộc khi status = ACTIVE',
    example: 'ipfs://QmXyz123.../metadata.json',
  })
  @IsOptional()
  @IsUrl({ protocols: ['ipfs', 'https'] }, { message: 'ipfs_metadata_uri phải là URL hợp lệ' })
  ipfs_metadata_uri?: string;
}

// ─── SearchArtworksDto ────────────────────────────────────────────────────────

export class SearchArtworksDto {
  @ApiPropertyOptional({ description: 'Từ khóa tìm kiếm (title)', example: 'Genesis' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ description: 'Lọc theo danh mục', enum: ARTWORK_CATEGORIES })
  @IsOptional()
  @IsIn(ARTWORK_CATEGORIES)
  category?: string;

  @ApiPropertyOptional({ description: 'Lọc theo loại bonding curve', enum: CurveType })
  @IsOptional()
  @IsIn(Object.values(CurveType))
  curve_type?: CurveType;

  @ApiPropertyOptional({
    description: 'Sắp xếp',
    enum: ['price', 'created_at', 'view_count', 'supply'],
    default: 'created_at',
  })
  @IsOptional()
  @IsIn(['price', 'created_at', 'view_count', 'supply'])
  sortBy?: 'price' | 'created_at' | 'view_count' | 'supply';

  @ApiPropertyOptional({ description: 'Trang', default: 1 })
  @IsOptional()
  @Type(() => Number)
  page?: number;

  @ApiPropertyOptional({ description: 'Số record / trang (tối đa 100)', default: 20 })
  @IsOptional()
  @Type(() => Number)
  limit?: number;
}

// ─── GetTradingHistoryQueryDto ────────────────────────────────────────────────

export class GetTradingHistoryQueryDto {
  @ApiPropertyOptional({ description: 'Trang hiện tại', default: 1, example: 1 })
  @IsOptional()
  @Type(() => Number)
  page?: number;

  @ApiPropertyOptional({ description: 'Số record mỗi trang (tối đa 100)', default: 20, example: 20 })
  @IsOptional()
  @Type(() => Number)
  limit?: number;
}
