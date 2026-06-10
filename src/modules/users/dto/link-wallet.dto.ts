import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, IsOptional, MaxLength } from 'class-validator';

export class WalletNonceDto {
  @ApiProperty({ example: '0xAbCd1234567890AbCd1234567890AbCd12345678' })
  @IsString()
  @Matches(/^0x[0-9a-fA-F]{40}$/, { message: 'wallet_address không đúng format Ethereum address' })
  wallet_address: string;
}

export class LinkWalletDto {
  @ApiProperty({ example: '0xAbCd1234567890AbCd1234567890AbCd12345678' })
  @IsString()
  @Matches(/^0x[0-9a-fA-F]{40}$/, { message: 'wallet_address không đúng format Ethereum address' })
  wallet_address: string;

  @ApiProperty({ description: 'Chữ ký personal_sign của SIWE message' })
  @IsString()
  signature: string;

  @ApiProperty({ description: 'SIWE message gốc từ bước nonce' })
  @IsString()
  message: string;

  @ApiProperty({ required: false, example: 'Ledger chính' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  label?: string;
}
