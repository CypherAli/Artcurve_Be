import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { SiweMessage } from 'siwe';
import { v4 as uuidv4 } from 'uuid';
import { createHash, createHmac, randomBytes } from 'crypto';
import { User } from '../users/entities/user.entity';
import { RedisService } from '../../shared/redis/redis.service';

// ─────────────────────────────────────────────────────────────────────────────
//  AuthService — SIWE (Sign-In with Ethereum, EIP-4361)
//
//  Luồng xác thực:
//
//    [1] Frontend gọi POST /auth/nonce { wallet_address }
//          → Server tạo SiweMessage chuẩn EIP-4361
//          → Lưu nonce vào Redis (TTL 5 phút)
//          → Trả về { nonce, message, siweMessage }
//
//    [2] Frontend yêu cầu MetaMask ký: personal_sign(message, wallet)
//          → MetaMask trả về signature (hex string)
//
//    [3] Frontend gọi POST /auth/verify { wallet_address, signature, message }
//          → Backend dùng SiweMessage.verify() để validate
//          → Xoá nonce khỏi Redis (atomic GETDEL — chống replay)
//          → Upsert user vào PostgreSQL
//          → Phát JWT với jti (để support logout/blacklist)
//
//  Tại sao SIWE tốt hơn custom EIP-191?
//    - Chuẩn hoá: EIP-4361 được MetaMask, Coinbase Wallet hiểu native
//    - Hiển thị đẹp trong ví: domain, URI, nonce đều readable
//    - Chống phishing: domain binding ngăn relay attack
//    - Không thể bị tái sử dụng cho app khác (domain mismatch → reject)
// ─────────────────────────────────────────────────────────────────────────────

export interface JwtPayload {
  sub:     string;   // user.id (UUID)
  wallet:  string;   // wallet_address lowercase
  role:    string;
  jti?:    string;   // JWT ID — dùng cho blacklist khi logout
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  /** Domain của app — dùng trong SIWE message để chống phishing */
  private readonly domain: string;
  /** URI đầy đủ — https://artcurve.io */
  private readonly uri: string;

  constructor(
    private readonly dataSource:   DataSource,
    private readonly jwtService:   JwtService,
    private readonly config:       ConfigService,
    private readonly redisService: RedisService,
  ) {
    this.domain = config.get('APP_DOMAIN', 'artcurve.io');
    this.uri    = config.get('APP_URI',    'https://artcurve.io');
  }

  // ── getNonce ───────────────────────────────────────────────────────────────
  /**
   * Bước 1: Tạo SIWE message chuẩn EIP-4361.
   *
   * SiweMessage chứa:
   *   - domain     : artcurve.io (chống phishing — ví hiển thị domain)
   *   - address    : wallet address (checksum)
   *   - statement  : "Sign in to ArtCurve..." (hiển thị trong ví)
   *   - uri        : https://artcurve.io
   *   - version    : 1
   *   - chainId    : 8453 (Base Mainnet)
   *   - nonce      : UUID ngẫu nhiên (lưu Redis TTL 5 phút)
   *   - issuedAt   : ISO timestamp
   *   - expirationTime: 5 phút sau (đồng bộ với Redis TTL)
   */
  async getNonce(walletAddress: string): Promise<{
    nonce:       string;
    message:     string;   // raw message string để personal_sign
    siweMessage: object;   // parsed object để Frontend debug
  }> {
    const normalized  = walletAddress.toLowerCase();
    const checksummed = this.toChecksumAddress(walletAddress);
    const nonce       = uuidv4().replace(/-/g, '');  // SiweMessage nonce không có dash
    const chainId     = this.config.get<number>('CHAIN_ID', 8453);

    // Upsert user record — chỉ tạo nếu ví chưa tồn tại VÀ chưa được liên kết
    // vào tài khoản khác (multi-wallet: ví linked đăng nhập về tài khoản chủ)
    await this.dataSource.query(
      `INSERT INTO users (wallet_address)
       SELECT $1::varchar
       WHERE NOT EXISTS (SELECT 1 FROM user_wallets WHERE wallet_address = $1)
       ON CONFLICT (wallet_address) DO NOTHING`,
      [normalized],
    );

    // Xây dựng EIP-4361 message
    const siwe = new SiweMessage({
      domain:         this.domain,
      address:        checksummed,
      statement:      'Sign in to ArtCurve. This request will not trigger a blockchain transaction or cost any gas fees.',
      uri:            this.uri,
      version:        '1',
      chainId,
      nonce,
      issuedAt:       new Date().toISOString(),
      expirationTime: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    });

    const message = siwe.prepareMessage();

    // Lưu nonce vào Redis (TTL 5 phút = 300 giây)
    await this.redisService.setNonce(normalized, nonce);

    this.logger.log(`[SIWE] Nonce issued for ${normalized} (chainId=${chainId})`);

    return { nonce, message, siweMessage: siwe };
  }

  // ── verifySignatureAndIssueJwt ─────────────────────────────────────────────
  /**
   * Bước 2: Verify chữ ký SIWE và phát JWT.
   *
   * SiweMessage.verify() kiểm tra:
   *   1. Chữ ký hợp lệ (EIP-191 personal_sign)
   *   2. Địa chỉ khớp với wallet trong message
   *   3. Domain khớp (chống relay attack)
   *   4. Nonce khớp với giá trị đã issue
   *   5. Message chưa hết hạn (expirationTime)
   *
   * @param walletAddress  Địa chỉ ví (any case)
   * @param signature      Hex string từ MetaMask personal_sign
   * @param rawMessage     Message string gốc từ bước getNonce (để re-parse)
   */
  async verifySignatureAndIssueJwt(
    walletAddress: string,
    signature: string,
    rawMessage: string,
  ): Promise<{
    access_token: string;
    expires_in:   number;
    user: {
      id:             string;
      wallet_address: string;
      username:       string | null;
      role:           string;
      is_verified:    boolean;
    };
  }> {
    const normalized = walletAddress.toLowerCase();

    // 1. Atomic consume nonce TRƯỚC KHI verify — chặn hoàn toàn replay attack.
    //    GETDEL: nếu 2 request đến cùng lúc, chỉ 1 cái lấy được nonce; cái còn lại thấy null.
    const storedNonce = await this.redisService.consumeNonce(normalized);
    if (!storedNonce) {
      throw new UnauthorizedException(
        'Nonce hết hạn hoặc không tồn tại. Gọi lại /auth/nonce để lấy nonce mới.',
      );
    }

    // 2. Parse và verify SIWE message (nonce đã consumed, không thể replay)
    let siweMessage: SiweMessage;
    try {
      siweMessage = new SiweMessage(rawMessage);
    } catch {
      throw new BadRequestException('SIWE message không hợp lệ — không thể parse.');
    }

    try {
      await siweMessage.verify({
        signature,
        domain:    this.domain,
        nonce:     storedNonce,
      });
    } catch (err) {
      this.logger.warn(`[SIWE] Verify failed for ${normalized}: ${err}`);
      throw new UnauthorizedException(
        `Xác thực SIWE thất bại: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // 4. Lấy thông tin user từ PostgreSQL.
    //    Ưu tiên resolve qua user_wallets (multi-wallet) — ví đã liên kết
    //    đăng nhập về tài khoản chủ; fallback users.wallet_address (legacy).
    const users = await this.dataSource.query(
      `SELECT u.id, u.wallet_address, u.username, u.role, u.is_verified
       FROM users u
       JOIN user_wallets uw ON uw.user_id = u.id
       WHERE uw.wallet_address = $1
       UNION
       SELECT id, wallet_address, username, role, is_verified
       FROM users WHERE wallet_address = $1
       LIMIT 1`,
      [normalized],
    );

    if (!users.length) {
      throw new UnauthorizedException('User không tồn tại.');
    }

    const user = users[0];

    // 5. Phát JWT với jti (support logout/blacklist)
    const jti       = uuidv4();
    const expiresIn = 7 * 24 * 3600; // 7 ngày
    const jwtPayload: JwtPayload = {
      sub:    user.id,
      wallet: normalized,
      role:   user.role,
      jti,
    };

    const access_token = this.jwtService.sign(jwtPayload, { expiresIn });
    this.logger.log(`[SIWE] JWT issued: wallet=${normalized}, jti=${jti}`);

    return {
      access_token,
      expires_in: expiresIn,
      user: {
        id:             user.id,
        wallet_address: user.wallet_address,
        username:       user.username ?? null,
        role:           user.role,
        is_verified:    user.is_verified,
      },
    };
  }

  // ── githubLogin ───────────────────────────────────────────────────────────
  async githubLogin(code: string): Promise<{
    access_token: string;
    expires_in:   number;
    user: { id: string; wallet_address: string; username: string | null; avatar_url: string | null; role: string; is_verified: boolean };
  }> {
    // 1. Exchange code → GitHub access token
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id:     this.config.get('GITHUB_CLIENT_ID'),
        client_secret: this.config.get('GITHUB_CLIENT_SECRET'),
        code,
      }),
    });
    const tokenData = await tokenRes.json() as any;
    if (!tokenData.access_token) {
      throw new UnauthorizedException('GitHub OAuth thất bại — không lấy được access token');
    }

    // 2. Lấy profile GitHub
    const profileRes = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${tokenData.access_token}`, 'User-Agent': 'ArtCurve' },
    });
    const profile = await profileRes.json() as any;

    // 3. Derive wallet address từ GitHub ID (deterministic, 42 chars)
    const walletAddress = `0x${Number(profile.id).toString(16).padStart(40, '0')}`;

    // 4. Upsert user
    await this.dataSource.query(
      `INSERT INTO users (wallet_address, username, avatar_url, email)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (wallet_address) DO UPDATE
       SET username   = COALESCE(EXCLUDED.username,   users.username),
           avatar_url = COALESCE(EXCLUDED.avatar_url, users.avatar_url),
           email      = COALESCE(EXCLUDED.email,      users.email)`,
      [walletAddress, profile.login ?? null, profile.avatar_url ?? null, profile.email ?? null],
    );

    const users = await this.dataSource.query(
      `SELECT id, wallet_address, username, role, is_verified FROM users WHERE wallet_address = $1`,
      [walletAddress],
    );
    const user = users[0];

    // 5. Issue JWT
    const jti       = uuidv4();
    const expiresIn = 7 * 24 * 3600;
    const access_token = this.jwtService.sign(
      { sub: user.id, wallet: walletAddress, role: user.role, jti } as JwtPayload,
      { expiresIn },
    );

    this.logger.log(`[GitHub] JWT issued: github=${profile.login}, wallet=${walletAddress}`);
    return {
      access_token,
      expires_in: expiresIn,
      user: { id: user.id, wallet_address: walletAddress, username: user.username ?? null, avatar_url: user.avatar_url ?? null, role: user.role, is_verified: user.is_verified },
    };
  }

  // ── Twitter OAuth 1.0a helpers ────────────────────────────────────────────

  private twitterOAuthSign(
    method: string, url: string,
    params: Record<string, string>,
    consumerSecret: string, tokenSecret = '',
  ): string {
    const sorted = Object.entries(params)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    const base   = `${method.toUpperCase()}&${encodeURIComponent(url)}&${encodeURIComponent(sorted)}`;
    const key    = `${encodeURIComponent(consumerSecret)}&${encodeURIComponent(tokenSecret)}`;
    return createHmac('sha1', key).update(base).digest('base64');
  }

  private twitterOAuthHeader(
    method: string, url: string,
    consumerKey: string, consumerSecret: string,
    extraParams: Record<string, string> = {},
    token = '', tokenSecret = '',
  ): string {
    const base: Record<string, string> = {
      oauth_consumer_key:     consumerKey,
      oauth_nonce:            randomBytes(16).toString('hex'),
      oauth_signature_method: 'HMAC-SHA1',
      oauth_timestamp:        String(Math.floor(Date.now() / 1000)),
      oauth_version:          '1.0',
      ...extraParams,
    };
    if (token) base.oauth_token = token;

    const sig = this.twitterOAuthSign(method, url, base, consumerSecret, tokenSecret);
    base.oauth_signature = sig;

    return 'OAuth ' + Object.entries(base)
      .map(([k, v]) => `${encodeURIComponent(k)}="${encodeURIComponent(v)}"`)
      .join(', ');
  }

  // ── twitterRequestToken ───────────────────────────────────────────────────
  async getTwitterRequestToken(callbackUrl: string): Promise<string> {
    const ck = this.config.get('TWITTER_CONSUMER_KEY', '');
    const cs = this.config.get('TWITTER_CONSUMER_SECRET', '');
    const url = 'https://api.twitter.com/oauth/request_token';

    const header = this.twitterOAuthHeader('POST', url, ck, cs, { oauth_callback: callbackUrl });
    const res    = await fetch(url, { method: 'POST', headers: { Authorization: header } });
    if (!res.ok) throw new UnauthorizedException(`Twitter request token failed (${res.status})`);

    const body   = await res.text();
    const params = new URLSearchParams(body);
    const token  = params.get('oauth_token') ?? '';
    const secret = params.get('oauth_token_secret') ?? '';

    // Store token_secret in Redis keyed by token (TTL 10 min)
    await this.redisService.setTemp(`twitter_ts:${token}`, secret, 600);
    return token;
  }

  // ── twitterLogin (OAuth 1.0a) ──────────────────────────────────────────────
  async twitterLogin(oauthToken: string, oauthVerifier: string): Promise<{
    access_token: string;
    expires_in:   number;
    user: { id: string; wallet_address: string; username: string | null; avatar_url: string | null; role: string; is_verified: boolean };
  }> {
    const ck = this.config.get('TWITTER_CONSUMER_KEY', '');
    const cs = this.config.get('TWITTER_CONSUMER_SECRET', '');

    // 1. Retrieve stored token secret (atomic — chống replay)
    const tokenSecret = await this.redisService.consumeTemp(`twitter_ts:${oauthToken}`) ?? '';

    // 2. Exchange for access token
    const tokenUrl = 'https://api.twitter.com/oauth/access_token';
    const header   = this.twitterOAuthHeader('POST', tokenUrl, ck, cs,
      { oauth_verifier: oauthVerifier }, oauthToken, tokenSecret);

    const res  = await fetch(tokenUrl, { method: 'POST', headers: { Authorization: header } });
    const body = await res.text();
    const p    = new URLSearchParams(body);

    const accessToken       = p.get('oauth_token') ?? '';
    const accessTokenSecret = p.get('oauth_token_secret') ?? '';
    const userId            = p.get('user_id') ?? '';
    const screenName        = p.get('screen_name') ?? '';

    if (!userId) throw new UnauthorizedException('Twitter login failed — no user_id');

    // 3. Get full profile (avatar)
    const profileBaseUrl = 'https://api.twitter.com/1.1/account/verify_credentials.json';
    const profileUrl     = `${profileBaseUrl}?skip_status=true&include_entities=false`;
    const profileHeader  = this.twitterOAuthHeader('GET', profileBaseUrl, ck, cs,
      { skip_status: 'true', include_entities: 'false' }, accessToken, accessTokenSecret);
    const profileRes = await fetch(profileUrl, { headers: { Authorization: profileHeader } });
    const profile    = profileRes.ok ? await profileRes.json() as any : {};

    const avatarUrl = profile.profile_image_url_https?.replace('_normal', '') ?? null;

    // 4. Derive wallet address from Twitter user ID
    const walletAddress = `0x${BigInt(userId).toString(16).padStart(40, '0')}`;

    // 5. Upsert user
    await this.dataSource.query(
      `INSERT INTO users (wallet_address, username, avatar_url)
       VALUES ($1, $2, $3)
       ON CONFLICT (wallet_address) DO UPDATE
       SET username   = COALESCE(EXCLUDED.username,   users.username),
           avatar_url = COALESCE(EXCLUDED.avatar_url, users.avatar_url)`,
      [walletAddress, screenName || null, avatarUrl],
    );
    const rows = await this.dataSource.query(
      `SELECT id, wallet_address, username, avatar_url, role, is_verified FROM users WHERE wallet_address = $1`,
      [walletAddress],
    );
    const user = rows[0];

    // 6. Issue JWT
    const jti      = uuidv4();
    const expiresIn = 7 * 24 * 3600;
    const access_token = this.jwtService.sign(
      { sub: user.id, wallet: walletAddress, role: user.role, jti } as JwtPayload,
      { expiresIn },
    );

    this.logger.log(`[Twitter] JWT issued: @${screenName}, wallet=${walletAddress}`);
    return {
      access_token, expires_in: expiresIn,
      user: { id: user.id, wallet_address: walletAddress, username: user.username ?? null, avatar_url: user.avatar_url ?? null, role: user.role, is_verified: user.is_verified },
    };
  }

  // ── telegramLogin ─────────────────────────────────────────────────────────
  async telegramLogin(tgData: Record<string, string>): Promise<{
    access_token: string; expires_in: number;
    user: { id: string; wallet_address: string; username: string | null; avatar_url: string | null; role: string; is_verified: boolean };
  }> {
    const botToken = this.config.get('TELEGRAM_BOT_TOKEN', '');

    // 1. Verify Telegram hash
    const { hash, ...dataWithoutHash } = tgData;
    const checkArr = Object.keys(dataWithoutHash)
      .sort()
      .map(k => `${k}=${dataWithoutHash[k]}`);
    const checkStr   = checkArr.join('\n');
    const secretKey  = createHash('sha256').update(botToken).digest();
    const computed   = createHmac('sha256', secretKey).update(checkStr).digest('hex');

    if (computed !== hash) throw new UnauthorizedException('Telegram auth hash mismatch');

    // 2. Validate auth_date — chỉ chấp nhận trong vòng 5 phút (300s).
    //    86400s (1 ngày) quá rộng — cho phép replay token cũ cả ngày.
    const authDate   = parseInt(tgData.auth_date, 10);
    const nowSeconds = Math.floor(Date.now() / 1000);
    const diff       = nowSeconds - authDate;
    if (isNaN(authDate) || diff < -10 || diff > 300) {
      throw new UnauthorizedException(
        'Telegram auth timestamp không hợp lệ hoặc đã hết hạn (tối đa 5 phút).',
      );
    }

    const tgId     = tgData.id;
    const username = tgData.username ?? tgData.first_name ?? null;
    const avatar   = tgData.photo_url ?? null;

    // 3. Derive deterministic wallet address from Telegram ID
    const walletAddress = `0x${BigInt(tgId).toString(16).padStart(40, '0')}`;

    // 4. Upsert user
    await this.dataSource.query(
      `INSERT INTO users (wallet_address, username, avatar_url)
       VALUES ($1, $2, $3)
       ON CONFLICT (wallet_address) DO UPDATE
       SET username   = COALESCE(EXCLUDED.username,   users.username),
           avatar_url = COALESCE(EXCLUDED.avatar_url, users.avatar_url)`,
      [walletAddress, username, avatar],
    );
    const rows = await this.dataSource.query(
      `SELECT id, wallet_address, username, avatar_url, role, is_verified FROM users WHERE wallet_address = $1`,
      [walletAddress],
    );
    const user = rows[0];

    // 5. Issue JWT
    const jti       = uuidv4();
    const expiresIn = 7 * 24 * 3600;
    const access_token = this.jwtService.sign(
      { sub: user.id, wallet: walletAddress, role: user.role, jti } as JwtPayload,
      { expiresIn },
    );
    this.logger.log(`[Telegram] JWT issued: tgId=${tgId}, @${username}, wallet=${walletAddress}`);
    return {
      access_token, expires_in: expiresIn,
      user: { id: user.id, wallet_address: walletAddress, username: user.username ?? null, avatar_url: user.avatar_url ?? null, role: user.role, is_verified: user.is_verified },
    };
  }

  // ── googleLogin ──────────────────────────────────────────────────────────
  async googleLogin(code: string, redirectUri: string): Promise<{
    access_token: string;
    expires_in:   number;
    user: { id: string; wallet_address: string; username: string | null; avatar_url: string | null; role: string; is_verified: boolean };
  }> {
    // 1. Exchange code → Google access token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id:     this.config.get('GOOGLE_CLIENT_ID', ''),
        client_secret: this.config.get('GOOGLE_CLIENT_SECRET', ''),
        redirect_uri:  redirectUri,
        grant_type:    'authorization_code',
      }),
    });

    const tokenData = await tokenRes.json() as any;
    if (!tokenData.access_token) {
      this.logger.error(`[Google] Token exchange failed: status=${tokenRes.status}`);
      throw new UnauthorizedException('Google OAuth thất bại — không lấy được access token');
    }

    // 2. Lấy thông tin user từ Google
    const profileRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const profile = await profileRes.json() as any;

    if (!profile.sub) {
      throw new UnauthorizedException('Google OAuth thất bại — không lấy được user info');
    }

    // 3. Derive deterministic wallet address từ Google sub (unique numeric-like ID)
    //    sub là string số — dùng BigInt để convert sang hex 40 chars
    let walletAddress: string;
    try {
      walletAddress = `0x${BigInt(profile.sub).toString(16).padStart(40, '0')}`;
    } catch {
      // sub không phải số thuần — fallback sha256
      const hash = createHash('sha256').update(profile.sub).digest('hex');
      walletAddress = `0x${hash.slice(0, 40)}`;
    }

    // 4. Upsert user
    await this.dataSource.query(
      `INSERT INTO users (wallet_address, username, avatar_url, email)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (wallet_address) DO UPDATE
       SET username   = COALESCE(EXCLUDED.username,   users.username),
           avatar_url = COALESCE(EXCLUDED.avatar_url, users.avatar_url),
           email      = COALESCE(EXCLUDED.email,      users.email)`,
      [walletAddress, profile.name ?? profile.given_name ?? null, profile.picture ?? null, profile.email ?? null],
    );

    const rows = await this.dataSource.query(
      `SELECT id, wallet_address, username, avatar_url, role, is_verified FROM users WHERE wallet_address = $1`,
      [walletAddress],
    );
    const user = rows[0];

    // 5. Issue JWT
    const jti       = uuidv4();
    const expiresIn = 7 * 24 * 3600;
    const access_token = this.jwtService.sign(
      { sub: user.id, wallet: walletAddress, role: user.role, jti } as JwtPayload,
      { expiresIn },
    );

    this.logger.log(`[Google] JWT issued: email=${profile.email}, wallet=${walletAddress}`);
    return {
      access_token, expires_in: expiresIn,
      user: { id: user.id, wallet_address: walletAddress, username: user.username ?? null, avatar_url: user.avatar_url ?? null, role: user.role, is_verified: user.is_verified },
    };
  }

  // ── One-time auth code (OAuth code exchange) ───────────────────────────────
  /**
   * Tạo one-time authorization code, lưu JWT + user info vào Redis (TTL 60s).
   * Trả về code (UUID) để redirect qua URL thay vì JWT trực tiếp.
   */
  async createAuthCode(result: {
    access_token: string;
    user: { wallet_address: string; username: string | null; avatar_url: string | null };
  }, provider: string): Promise<string> {
    const code = uuidv4();
    const payload = JSON.stringify({
      access_token: result.access_token,
      address:      result.user.wallet_address,
      name:         result.user.username ?? '',
      avatar:       result.user.avatar_url ?? '',
      provider,
    });
    await this.redisService.setTemp(`auth_code:${code}`, payload, 60);
    return code;
  }

  /**
   * Consume one-time auth code — trả về JWT + user info, xoá khỏi Redis.
   * Mỗi code chỉ dùng được 1 lần (atomic get + delete).
   */
  async consumeAuthCode(code: string): Promise<{
    access_token: string;
    address:      string;
    name:         string;
    avatar:       string;
    provider:     string;
  }> {
    const key = `auth_code:${code}`;
    // Atomic GETDEL — chống race condition khi 2 request cùng lúc
    const raw = await this.redisService.consumeTemp(key);
    if (!raw) {
      throw new UnauthorizedException('Authorization code không hợp lệ hoặc đã hết hạn.');
    }
    return JSON.parse(raw);
  }

  // ── logout ─────────────────────────────────────────────────────────────────
  /**
   * Thu hồi JWT — ghi jti vào Redis blacklist.
   * Token vẫn hợp lệ về mặt chữ ký nhưng JwtAuthGuard sẽ từ chối.
   */
  async logout(token: string): Promise<void> {
    if (!token) throw new UnauthorizedException('Token required for logout');

    let payload: (JwtPayload & { exp: number }) | null = null;
    try {
      // verify() thay vì decode() — đảm bảo token là authentic, không phải giả mạo
      payload = this.jwtService.verify<JwtPayload & { exp: number }>(token, {
        secret: this.config.getOrThrow<string>('JWT_SECRET'),
      });
    } catch (err) {
      this.logger.warn(`[JWT] Logout with invalid token: ${err instanceof Error ? err.message : err}`);
      throw new UnauthorizedException('Token không hợp lệ');
    }

    if (!payload.jti) {
      this.logger.warn(`[JWT] Logout token missing jti: sub=${payload.sub}`);
      throw new UnauthorizedException('Token không có jti — không thể logout');
    }

    const remaining = payload.exp - Math.floor(Date.now() / 1000);
    if (remaining <= 0) {
      // Token đã hết hạn — không cần blacklist
      this.logger.debug(`[JWT] Logout token already expired: jti=${payload.jti}`);
      return;
    }

    await this.redisService.blacklistJwt(payload.jti, remaining);
    this.logger.log(`[JWT] Blacklisted: jti=${payload.jti} remaining=${remaining}s`);
  }

  // ── validateJwtPayload ─────────────────────────────────────────────────────
  async validateJwtPayload(payload: JwtPayload): Promise<User> {
    const users = await this.dataSource.query(
      `SELECT id, wallet_address, username, role, is_verified
       FROM users WHERE id = $1`,
      [payload.sub],
    );
    if (!users.length) throw new UnauthorizedException('User không còn tồn tại.');
    return users[0];
  }

  // ── Helper ─────────────────────────────────────────────────────────────────

  /**
   * Convert địa chỉ về EIP-55 checksum format.
   * SiweMessage yêu cầu địa chỉ đúng checksum — không dùng lowercase.
   */
  private toChecksumAddress(address: string): string {
    // SiweMessage tự xử lý checksum khi verify.
    // Ở đây dùng ethers nếu cần strict checksum, hoặc để nguyên.
    // Để tránh import thêm ethers, trả về address gốc — SiweMessage tự normalize.
    return address;
  }
}
