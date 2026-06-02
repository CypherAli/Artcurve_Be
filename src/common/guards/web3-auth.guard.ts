import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Socket } from 'socket.io';
import { RedisService } from '../../shared/redis/redis.service';
import { JwtPayload } from '../../modules/auth/auth.service';

// ─────────────────────────────────────────────────────────────────────────────
//  Web3AuthGuard  (src/common/guards/)
//
//  Guard duy nhất cho cả hai transport:
//    1. HTTP request   — đọc "Authorization: Bearer <token>" từ header
//    2. WebSocket (Socket.IO) — đọc token từ handshake:
//         - handshake.auth.token  (khuyến nghị — client gửi khi connect)
//         - handshake.headers.authorization  (fallback — Bearer prefix)
//         - handshake.query.token  (legacy — query string)
//
//  Sau khi decode JWT:
//    - Kiểm tra Redis blacklist (jti) — chặn token đã logout
//    - Gắn payload vào request['user'] hoặc socket.data.user
//
//  Cách dùng:
//    // HTTP Controller:
//    @UseGuards(Web3AuthGuard)
//    @Get('protected')
//    getProtected(@Request() req) { return req.user; }
//
//    // WebSocket Gateway:
//    @UseGuards(Web3AuthGuard)
//    @WebSocketGateway()
//    export class EventsGateway { }
//    // Lúc connect: socket.auth = { token: 'eyJ...' }
//    // Sau khi connect: socket.data.user = JwtPayload
//
//  @Public() decorator vẫn hoạt động để bypass guard này.
// ─────────────────────────────────────────────────────────────────────────────

/** Decorator key — dùng @Public() để bypass guard */
export const IS_PUBLIC_KEY = 'isPublic';

@Injectable()
export class Web3AuthGuard implements CanActivate {
  private readonly logger = new Logger(Web3AuthGuard.name);

  constructor(
    private readonly reflector:    Reflector,
    private readonly jwtService:   JwtService,
    private readonly config:       ConfigService,
    private readonly redisService: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Kiểm tra @Public() — bypass guard nếu có
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const type = context.getType();

    if (type === 'ws') {
      return this.handleWebSocket(context);
    }

    // Default: HTTP
    return this.handleHttp(context);
  }

  // ── HTTP ──────────────────────────────────────────────────────────────────

  private async handleHttp(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token   = this.extractBearerToken(request.headers['authorization']);

    if (!token) {
      throw new UnauthorizedException(
        'Authorization header không tìm thấy. Format: Authorization: Bearer <token>',
      );
    }

    const payload = await this.verifyToken(token);
    request['user'] = payload;
    return true;
  }

  // ── WebSocket ─────────────────────────────────────────────────────────────

  private async handleWebSocket(context: ExecutionContext): Promise<boolean> {
    const client: Socket = context.switchToWs().getClient<Socket>();

    // Ưu tiên đọc theo thứ tự: auth.token → header authorization → query.token
    const token =
      client.handshake?.auth?.token                                  ||
      this.extractBearerToken(client.handshake?.headers?.authorization as string) ||
      (client.handshake?.query?.token as string)                     ||
      null;

    if (!token) {
      this.logger.warn(`WS auth failed: no token (socketId=${client.id})`);
      client.emit('auth_error', { message: 'Authentication token required.' });
      client.disconnect(true);
      return false;
    }

    try {
      const payload = await this.verifyToken(token);
      // Gắn user vào socket.data để các handler sau có thể đọc
      client.data.user = payload;
      return true;
    } catch (err) {
      this.logger.warn(`WS auth rejected: ${err.message} (socketId=${client.id})`);
      client.emit('auth_error', { message: err.message });
      client.disconnect(true);
      return false;
    }
  }

  // ── Core verify ───────────────────────────────────────────────────────────

  private async verifyToken(token: string): Promise<JwtPayload> {
    let payload: JwtPayload & { exp: number };

    // 1. Verify chữ ký JWT
    try {
      const secret = this.config.getOrThrow<string>('JWT_SECRET');
      payload = this.jwtService.verify(token, { secret });
    } catch {
      throw new UnauthorizedException('JWT không hợp lệ hoặc đã hết hạn.');
    }

    // 2. Kiểm tra blacklist (jti) — token đã bị thu hồi qua logout
    if (payload.jti) {
      const blacklisted = await this.redisService.isJwtBlacklisted(payload.jti);
      if (blacklisted) {
        throw new UnauthorizedException('Token đã bị thu hồi. Vui lòng đăng nhập lại.');
      }
    }

    return payload;
  }

  // ── Helper ────────────────────────────────────────────────────────────────

  private extractBearerToken(authHeader?: string): string | null {
    if (!authHeader?.startsWith('Bearer ')) return null;
    return authHeader.substring(7).trim() || null;
  }
}
