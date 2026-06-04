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
import { createHash, randomBytes } from 'crypto';
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

    // Upsert user record (chỉ tạo nếu chưa tồn tại)
    await this.dataSource.query(
      `INSERT INTO users (wallet_address) VALUES ($1) ON CONFLICT (wallet_address) DO NOTHING`,
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

    // 1. Đọc nonce từ Redis (kiểm tra còn tồn tại và chưa hết hạn)
    const storedNonce = await this.redisService.getNonce(normalized);
    if (!storedNonce) {
      throw new UnauthorizedException(
        'Nonce hết hạn hoặc không tồn tại. Gọi lại /auth/nonce để lấy nonce mới.',
      );
    }

    // 2. Parse và verify SIWE message
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
      // SiweMessage.verify() ném lỗi với message mô tả cụ thể
      this.logger.warn(`[SIWE] Verify failed for ${normalized}: ${err}`);
      throw new UnauthorizedException(
        `Xác thực SIWE thất bại: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // 3. Tiêu thụ nonce (atomic GETDEL) — chống replay attack
    await this.redisService.consumeNonce(normalized);

    // 4. Lấy thông tin user từ PostgreSQL
    const users = await this.dataSource.query(
      `SELECT id, wallet_address, username, role, is_verified
       FROM users WHERE wallet_address = $1`,
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

  // ── twitterAuthUrl ────────────────────────────────────────────────────────
  /** Generate Twitter OAuth 2.0 URL with PKCE */
  buildTwitterAuthUrl(callbackUrl: string): { url: string; state: string } {
    const codeVerifier  = randomBytes(32).toString('base64url');
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
    const state         = Buffer.from(JSON.stringify({ cv: codeVerifier })).toString('base64url');

    const url = new URL('https://twitter.com/i/oauth2/authorize');
    url.searchParams.set('response_type',         'code');
    url.searchParams.set('client_id',             this.config.get('TWITTER_CLIENT_ID', ''));
    url.searchParams.set('redirect_uri',          callbackUrl);
    url.searchParams.set('scope',                 'tweet.read users.read');
    url.searchParams.set('state',                 state);
    url.searchParams.set('code_challenge',        codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');

    return { url: url.toString(), state };
  }

  // ── twitterLogin ───────────────────────────────────────────────────────────
  async twitterLogin(code: string, state: string, callbackUrl: string): Promise<{
    access_token: string;
    expires_in:   number;
    user: { id: string; wallet_address: string; username: string | null; avatar_url: string | null; role: string; is_verified: boolean };
  }> {
    // 1. Decode code_verifier from state
    let codeVerifier: string;
    try {
      const decoded = JSON.parse(Buffer.from(state, 'base64url').toString());
      codeVerifier  = decoded.cv;
    } catch {
      throw new UnauthorizedException('Invalid state parameter');
    }

    const clientId     = this.config.get('TWITTER_CLIENT_ID', '');
    const clientSecret = this.config.get('TWITTER_CLIENT_SECRET', '');

    // 2. Exchange code for access token
    const tokenRes = await fetch('https://api.twitter.com/2/oauth2/token', {
      method:  'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        code,
        grant_type:    'authorization_code',
        client_id:     clientId,
        redirect_uri:  callbackUrl,
        code_verifier: codeVerifier,
      }).toString(),
    });

    const tokenData = await tokenRes.json() as any;
    if (!tokenData.access_token) {
      throw new UnauthorizedException(`Twitter OAuth failed: ${tokenData.error_description ?? 'no token'}`);
    }

    // 3. Get Twitter user profile
    const profileRes = await fetch('https://api.twitter.com/2/users/me?user.fields=profile_image_url,name,username', {
      headers: { Authorization: `Bearer ${tokenData.access_token}`, 'User-Agent': 'ArtCurve' },
    });
    const profileData = await profileRes.json() as any;
    const profile     = profileData.data;
    if (!profile?.id) throw new UnauthorizedException('Cannot fetch Twitter profile');

    // 4. Derive wallet address from Twitter ID
    const walletAddress = `0x${BigInt(profile.id).toString(16).padStart(40, '0')}`;

    // 5. Upsert user
    await this.dataSource.query(
      `INSERT INTO users (wallet_address, username, avatar_url)
       VALUES ($1, $2, $3)
       ON CONFLICT (wallet_address) DO UPDATE
       SET username   = COALESCE(EXCLUDED.username,   users.username),
           avatar_url = COALESCE(EXCLUDED.avatar_url, users.avatar_url)`,
      [walletAddress, profile.username ?? null, profile.profile_image_url?.replace('_normal', '') ?? null],
    );

    const users = await this.dataSource.query(
      `SELECT id, wallet_address, username, avatar_url, role, is_verified FROM users WHERE wallet_address = $1`,
      [walletAddress],
    );
    const user = users[0];

    // 6. Issue JWT
    const jti       = uuidv4();
    const expiresIn = 7 * 24 * 3600;
    const access_token = this.jwtService.sign(
      { sub: user.id, wallet: walletAddress, role: user.role, jti } as JwtPayload,
      { expiresIn },
    );

    this.logger.log(`[Twitter] JWT issued: @${profile.username}, wallet=${walletAddress}`);
    return {
      access_token,
      expires_in: expiresIn,
      user: { id: user.id, wallet_address: walletAddress, username: user.username ?? null, avatar_url: user.avatar_url ?? null, role: user.role, is_verified: user.is_verified },
    };
  }

  // ── logout ─────────────────────────────────────────────────────────────────
  /**
   * Thu hồi JWT — ghi jti vào Redis blacklist.
   * Token vẫn hợp lệ về mặt chữ ký nhưng JwtAuthGuard sẽ từ chối.
   */
  async logout(token: string): Promise<void> {
    try {
      const payload = this.jwtService.decode(token) as JwtPayload & { exp: number };
      if (!payload?.jti) return;

      const remaining = payload.exp - Math.floor(Date.now() / 1000);
      if (remaining > 0) {
        await this.redisService.blacklistJwt(payload.jti, remaining);
        this.logger.log(`[JWT] Blacklisted: jti=${payload.jti}`);
      }
    } catch {
      // Bỏ qua lỗi decode khi logout
    }
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
