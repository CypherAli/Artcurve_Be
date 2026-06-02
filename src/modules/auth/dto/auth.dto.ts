import { IsString, IsNotEmpty, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

// ─── NonceRequestDto ──────────────────────────────────────────────────────────

export class NonceRequestDto {
  @ApiProperty({
    description: 'Địa chỉ ví Ethereum của user',
    example: '0xAbCd1234567890AbCd1234567890AbCd12345678',
    pattern: '^0x[0-9a-fA-F]{40}$',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^0x[0-9a-fA-F]{40}$/, {
    message: 'wallet_address không đúng format Ethereum',
  })
  wallet_address: string;
}

// ─── VerifySignatureDto ───────────────────────────────────────────────────────

export class VerifySignatureDto {
  @ApiProperty({
    description: 'Địa chỉ ví đã ký message',
    example: '0xAbCd1234567890AbCd1234567890AbCd12345678',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^0x[0-9a-fA-F]{40}$/, {
    message: 'wallet_address không đúng format Ethereum',
  })
  wallet_address: string;

  @ApiProperty({
    description: 'Chữ ký EIP-191 từ MetaMask/WalletConnect (hex string 0x...)',
    example: '0x1b2c3d...(132 hex chars)',
  })
  @IsString()
  @IsNotEmpty()
  signature: string;

  @ApiProperty({
    description:
      'Raw SIWE message string nhận được từ GET /auth/nonce — ' +
      'gửi nguyên xi để Backend re-parse và verify domain/nonce/expiry.',
    example: 'artcurve.io wants you to sign in with your Ethereum account:\n0x...',
  })
  @IsString()
  @IsNotEmpty()
  message: string;
}

// ─── Response types ───────────────────────────────────────────────────────────

export class NonceResponseDto {
  @ApiProperty({ example: 'artcurve:nonce:a1b2c3d4-e5f6-...' })
  nonce: string;

  @ApiProperty({ example: 'Sign this message to login to ArtCurve.\n\nNonce: artcurve:nonce:...' })
  message: string;
}

export class AuthResponseDto {
  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIs...' })
  access_token: string;

  @ApiProperty({ example: 3600 })
  expires_in: number;

  @ApiProperty({ example: { id: 'uuid', wallet_address: '0x...', role: 'user' } })
  user: {
    id: string;
    wallet_address: string;
    username: string | null;
    role: string;
    is_verified: boolean;
  };
}
