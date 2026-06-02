import {
  Controller,
  Post,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import {
  NonceRequestDto,
  VerifySignatureDto,
  NonceResponseDto,
  AuthResponseDto,
} from './dto/auth.dto';
import { Public, CurrentUser } from './decorators';

@ApiTags('Auth — Web3 Sign-In')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // ── POST /auth/nonce ───────────────────────────────────────────────────────

  @Post('nonce')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Buoc 1: Lay nonce de ky',
    description:
      'Frontend goi truoc khi yeu cau MetaMask ky. ' +
      'Nonce duoc luu vao **Redis** voi TTL 5 phut (khong con ghi vao PostgreSQL). ' +
      'Neu het 5 phut chua ky -> goi lai endpoint nay.',
  })
  @ApiResponse({ status: 200, type: NonceResponseDto })
  async getNonce(@Body() dto: NonceRequestDto): Promise<NonceResponseDto> {
    return this.authService.getNonce(dto.wallet_address);
  }

  // ── POST /auth/verify ──────────────────────────────────────────────────────

  @Post('verify')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Buoc 2: Verify chu ky EIP-191 va nhan JWT',
    description:
      'Backend dung ethers.verifyMessage() de recover dia chi ky. ' +
      'Nonce duoc GETDEL (atomic) ngay sau khi verify -> chong replay attack tuyet doi. ' +
      'JWT tra ve co jti de ho tro logout that su.',
  })
  @ApiResponse({ status: 200, type: AuthResponseDto })
  @ApiResponse({ status: 401, description: 'Chu ky khong hop le hoac nonce het han' })
  async verify(@Body() dto: VerifySignatureDto): Promise<AuthResponseDto> {
    return this.authService.verifySignatureAndIssueJwt(
      dto.wallet_address,
      dto.signature,
      dto.message,   // raw SIWE message string — cần để re-parse + verify domain
    );
  }

  // ── POST /auth/logout ──────────────────────────────────────────────────────

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Logout — thu hoi JWT',
    description:
      'Ghi jti cua JWT vao Redis blacklist. ' +
      'Moi request tiep theo voi token nay se bi tu choi, ' +
      'du token chua het han. TTL blacklist = thoi gian con lai cua token.',
  })
  @ApiResponse({ status: 204, description: 'Da logout thanh cong' })
  @ApiResponse({ status: 401, description: 'Chua dang nhap' })
  async logout(@Headers('authorization') authHeader: string): Promise<void> {
    const token = authHeader?.replace('Bearer ', '') ?? '';
    await this.authService.logout(token);
  }
}
