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
  BadRequestException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { ConfigService }  from '@nestjs/config';
import { Throttle }       from '@nestjs/throttler';
import { AuthService }    from './auth.service';
import { RedisService }   from '../../shared/redis/redis.service';
import {
  NonceRequestDto,
  VerifySignatureDto,
  NonceResponseDto,
  AuthResponseDto,
} from './dto/auth.dto';
import { Public, CurrentUser } from './decorators';
import { randomBytes }    from 'crypto';

// Danh sách frontend URL được phép nhận OAuth redirect — chống Open Redirect
const ALLOWED_FRONTEND_ORIGINS = new Set([
  'https://artcurve-fe.vercel.app',
  'https://artcurve.io',
  'https://www.artcurve.io',
  'http://localhost:3000',
  'http://localhost:3001',
]);

function safeFrontendUrl(config: ConfigService): string {
  const url = config.get<string>('FRONTEND_URL', 'https://artcurve-fe.vercel.app').trim();
  if (ALLOWED_FRONTEND_ORIGINS.has(url)) return url;
  // Fallback về giá trị an toàn nếu env bị misconfigure
  return 'https://artcurve-fe.vercel.app';
}

@ApiTags('Auth — Web3 Sign-In')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService:   AuthService,
    private readonly redisService:  RedisService,
    private readonly config:        ConfigService,
  ) {}

  // ── POST /auth/nonce ───────────────────────────────────────────────────────

  @Post('nonce')
  @Public()
  @HttpCode(HttpStatus.OK)
  // 10 nonce requests / phút / IP — chống DoS nonce exhaustion
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Buoc 1: Lay nonce de ky SIWE (EIP-4361)' })
  @ApiResponse({ status: 200, type: NonceResponseDto })
  async getNonce(@Body() dto: NonceRequestDto): Promise<NonceResponseDto> {
    return this.authService.getNonce(dto.wallet_address);
  }

  // ── POST /auth/verify ──────────────────────────────────────────────────────

  @Post('verify')
  @Public()
  @HttpCode(HttpStatus.OK)
  // 5 lần verify / phút / IP — chống brute force signature
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Buoc 2: Verify chu ky SIWE va nhan JWT' })
  @ApiResponse({ status: 200, type: AuthResponseDto })
  @ApiResponse({ status: 401, description: 'Chu ky khong hop le hoac nonce het han' })
  async verify(@Body() dto: VerifySignatureDto): Promise<AuthResponseDto> {
    return this.authService.verifySignatureAndIssueJwt(
      dto.wallet_address,
      dto.signature,
      dto.message,
    );
  }

  // ── GET /auth/github ──────────────────────────────────────────────────────

  @Get('github')
  @Public()
  // 5 OAuth inits / phút / IP
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'GitHub OAuth — redirect to GitHub (CSRF-protected)' })
  async githubRedirect(@Res() res: Response) {
    const clientId   = this.config.get<string>('GITHUB_CLIENT_ID', '');
    if (!clientId) {
      this.logger.error('[GitHub] GITHUB_CLIENT_ID not configured');
      return res.redirect(`${safeFrontendUrl(this.config)}/?auth_error=github_not_configured`);
    }

    // CSRF state — lưu vào Redis 10 phút
    const state      = randomBytes(32).toString('hex');
    await this.redisService.setTemp(`oauth_state_gh:${state}`, '1', 600);

    const backendUrl = this.config.get<string>('APP_URI', 'https://artcurve-be.onrender.com');
    const callback   = `${backendUrl}/api/v1/auth/github/callback`;
    const url = `https://github.com/login/oauth/authorize` +
      `?client_id=${encodeURIComponent(clientId)}` +
      `&redirect_uri=${encodeURIComponent(callback)}` +
      `&scope=read:user,user:email` +
      `&state=${state}`;
    res.redirect(url);
  }

  // ── GET /auth/github/callback ──────────────────────────────────────────────

  @Get('github/callback')
  @Public()
  @ApiOperation({ summary: 'GitHub OAuth — callback & issue JWT' })
  async githubCallback(
    @Query('code')  code:  string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    const frontendUrl = safeFrontendUrl(this.config);
    try {
      // Verify CSRF state
      if (!state) throw new UnauthorizedException('Missing OAuth state parameter');
      const stored = await this.redisService.getTemp(`oauth_state_gh:${state}`);
      if (!stored) throw new UnauthorizedException('Invalid or expired OAuth state (possible CSRF)');
      await this.redisService.deleteTemp(`oauth_state_gh:${state}`);

      if (!code) throw new BadRequestException('Missing code parameter');

      const result = await this.authService.githubLogin(code);
      const params = new URLSearchParams({
        token:    result.access_token,
        address:  result.user.wallet_address,
        name:     result.user.username  ?? '',
        avatar:   result.user.avatar_url ?? '',
        provider: 'github',
      });
      // Dùng URL constructor — không concat string thô
      const redirectUrl = new URL('/auth/callback', frontendUrl);
      redirectUrl.search = params.toString();
      res.redirect(redirectUrl.toString());
    } catch (err) {
      this.logger.error(`[GitHub] Callback error: ${err instanceof Error ? err.message : err}`);
      res.redirect(`${frontendUrl}/?auth_error=github_failed`);
    }
  }

  // ── GET /auth/twitter ─────────────────────────────────────────────────────

  @Get('twitter')
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Twitter/X OAuth 1.0a — redirect to X' })
  async twitterRedirect(@Res() res: Response) {
    try {
      const backendUrl  = this.config.get<string>('APP_URI', 'https://artcurve-be.onrender.com');
      const callbackUrl = `${backendUrl}/api/v1/auth/twitter/callback`;
      const oauthToken  = await this.authService.getTwitterRequestToken(callbackUrl);
      res.redirect(`https://api.twitter.com/oauth/authenticate?oauth_token=${oauthToken}`);
    } catch (err) {
      this.logger.error(`[Twitter] Redirect error: ${err instanceof Error ? err.message : err}`);
      res.redirect(`${safeFrontendUrl(this.config)}/?auth_error=twitter_init_failed`);
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
    const frontendUrl = safeFrontendUrl(this.config);
    try {
      if (!oauthToken || !oauthVerifier) throw new BadRequestException('Missing OAuth params');

      const result = await this.authService.twitterLogin(oauthToken, oauthVerifier);
      const params = new URLSearchParams({
        token:    result.access_token,
        address:  result.user.wallet_address,
        name:     result.user.username  ?? '',
        avatar:   result.user.avatar_url ?? '',
        provider: 'twitter',
      });
      const redirectUrl = new URL('/auth/callback', frontendUrl);
      redirectUrl.search = params.toString();
      res.redirect(redirectUrl.toString());
    } catch (err) {
      this.logger.error(`[Twitter] Callback error: ${err instanceof Error ? err.message : err}`);
      res.redirect(`${frontendUrl}/?auth_error=twitter_failed`);
    }
  }

  // ── GET /auth/telegram ────────────────────────────────────────────────────

  @Get('telegram')
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Telegram Login — redirect to Telegram OAuth' })
  telegramRedirect(@Res() res: Response) {
    const botToken = this.config.get<string>('TELEGRAM_BOT_TOKEN', '');
    if (!botToken) {
      this.logger.error('[Telegram] TELEGRAM_BOT_TOKEN not configured');
      return res.redirect(`${safeFrontendUrl(this.config)}/?auth_error=telegram_not_configured`);
    }
    const botId      = botToken.split(':')[0];
    const backendUrl = this.config.get<string>('APP_URI', 'https://artcurve-be.onrender.com');
    const returnTo   = encodeURIComponent(`${backendUrl}/api/v1/auth/telegram/callback`);
    const origin     = encodeURIComponent(backendUrl);
    res.redirect(
      `https://oauth.telegram.org/auth?bot_id=${botId}&origin=${origin}&return_to=${returnTo}`,
    );
  }

  // ── GET /auth/telegram/callback ───────────────────────────────────────────

  @Get('telegram/callback')
  @Public()
  @ApiOperation({ summary: 'Telegram Login — verify hash & issue JWT' })
  async telegramCallback(@Query() query: Record<string, string>, @Res() res: Response) {
    const frontendUrl = safeFrontendUrl(this.config);
    try {
      // Telegram may encode user data in tgAuthResult (base64url JSON)
      let tgData = { ...query };
      if (query.tgAuthResult) {
        let decoded: unknown;
        try {
          const jsonStr = Buffer.from(query.tgAuthResult, 'base64').toString('utf-8');
          decoded = JSON.parse(jsonStr);
        } catch {
          throw new BadRequestException('tgAuthResult không phải JSON hợp lệ');
        }
        if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) {
          throw new BadRequestException('tgAuthResult có cấu trúc không hợp lệ');
        }
        // Chỉ merge các field string — tránh prototype pollution
        const safe: Record<string, string> = {};
        for (const [k, v] of Object.entries(decoded as Record<string, unknown>)) {
          if (typeof v === 'string' || typeof v === 'number') safe[k] = String(v);
        }
        tgData = { ...tgData, ...safe };
        delete tgData['tgAuthResult'];
      }

      const result = await this.authService.telegramLogin(tgData);
      const params = new URLSearchParams({
        token:    result.access_token,
        address:  result.user.wallet_address,
        name:     result.user.username  ?? '',
        avatar:   result.user.avatar_url ?? '',
        provider: 'telegram',
      });
      const redirectUrl = new URL('/auth/callback', frontendUrl);
      redirectUrl.search = params.toString();
      res.redirect(redirectUrl.toString());
    } catch (err) {
      this.logger.error(`[Telegram] Callback error: ${err instanceof Error ? err.message : err}`);
      res.redirect(`${frontendUrl}/?auth_error=telegram_failed`);
    }
  }

  // ── POST /auth/logout ──────────────────────────────────────────────────────

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Logout — thu hoi JWT (blacklist jti trong Redis)' })
  @ApiResponse({ status: 204, description: 'Da logout thanh cong' })
  @ApiResponse({ status: 401, description: 'Chua dang nhap hoac token khong hop le' })
  async logout(@Headers('authorization') authHeader: string): Promise<void> {
    const token = authHeader?.replace(/^Bearer\s+/i, '').trim();
    if (!token) throw new UnauthorizedException('Authorization header bắt buộc');
    await this.authService.logout(token);
  }
}
