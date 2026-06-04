import {
  Controller,
  Post,
  Get,
  Body,
  Headers,
  Query,
  Res,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
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
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

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

  // ── GET /auth/github ──────────────────────────────────────────────────────

  @Get('github')
  @Public()
  @ApiOperation({ summary: 'GitHub OAuth — redirect to GitHub' })
  githubRedirect(@Res() res: Response) {
    const clientId   = this.config.get('GITHUB_CLIENT_ID');
    const backendUrl = this.config.get('APP_URI', 'https://artcurve-be.onrender.com');
    const callback   = `${backendUrl}/api/v1/auth/github/callback`;
    const url = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(callback)}&scope=read:user,user:email`;
    res.redirect(url);
  }

  // ── GET /auth/github/callback ──────────────────────────────────────────────

  @Get('github/callback')
  @Public()
  @ApiOperation({ summary: 'GitHub OAuth — callback & issue JWT' })
  async githubCallback(@Query('code') code: string, @Res() res: Response) {
    try {
      const result      = await this.authService.githubLogin(code);
      const frontendUrl = this.config.get('FRONTEND_URL', 'https://artcurve-fe.vercel.app');
      const params = new URLSearchParams({
        token:   result.access_token,
        address: result.user.wallet_address,
        name:    result.user.username ?? '',
        avatar:  result.user.avatar_url ?? '',
      });
      res.redirect(`${frontendUrl}/auth/callback?${params.toString()}`);
    } catch {
      const frontendUrl = this.config.get('FRONTEND_URL', 'https://artcurve-fe.vercel.app');
      res.redirect(`${frontendUrl}/?auth_error=github_failed`);
    }
  }

  // ── GET /auth/twitter ─────────────────────────────────────────────────────

  @Get('twitter')
  @Public()
  @ApiOperation({ summary: 'Twitter/X OAuth 1.0a — redirect to X' })
  async twitterRedirect(@Res() res: Response) {
    try {
      const backendUrl  = this.config.get('APP_URI', 'https://artcurve-be.onrender.com');
      const callbackUrl = `${backendUrl}/api/v1/auth/twitter/callback`;
      const oauthToken  = await this.authService.getTwitterRequestToken(callbackUrl);
      res.redirect(`https://api.twitter.com/oauth/authenticate?oauth_token=${oauthToken}`);
    } catch (err) {
      const frontendUrl = this.config.get('FRONTEND_URL', 'https://artcurve-fe.vercel.app');
      this.config['logger']?.error?.(err);
      res.redirect(`${frontendUrl}/?auth_error=twitter_init_failed`);
    }
  }

  // ── GET /auth/twitter/callback ────────────────────────────────────────────

  @Get('twitter/callback')
  @Public()
  @ApiOperation({ summary: 'Twitter/X OAuth 1.0a — callback & issue JWT' })
  async twitterCallback(
    @Query('oauth_token')    oauthToken:    string,
    @Query('oauth_verifier') oauthVerifier: string,
    @Res() res: Response,
  ) {
    const frontendUrl = this.config.get('FRONTEND_URL', 'https://artcurve-fe.vercel.app');
    try {
      const result = await this.authService.twitterLogin(oauthToken, oauthVerifier);
      const params = new URLSearchParams({
        token:    result.access_token,
        address:  result.user.wallet_address,
        name:     result.user.username ?? '',
        avatar:   result.user.avatar_url ?? '',
        provider: 'twitter',
      });
      res.redirect(`${frontendUrl}/auth/callback?${params.toString()}`);
    } catch {
      res.redirect(`${frontendUrl}/?auth_error=twitter_failed`);
    }
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
