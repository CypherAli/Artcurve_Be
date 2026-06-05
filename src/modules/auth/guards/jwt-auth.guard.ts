import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
  CanActivate,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { IS_PUBLIC_KEY, ROLES_KEY } from '../decorators';
import { RedisService } from '../../../shared/redis/redis.service';
import { JwtPayload } from '../auth.service';

// ─── JwtAuthGuard ─────────────────────────────────────────────────────────────
// Global guard — moi route bi block tru khi co @Public()
// Sau khi verify JWT -> kiem tra blacklist Redis -> neu bi logout -> tu choi

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector:     Reflector,
    private readonly jwtService:    JwtService,
    private readonly config:        ConfigService,
    private readonly redisService:  RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // @Public() — skip auth
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const authHeader: string | undefined = request.headers['authorization'];

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Thieu Authorization header. Format: Bearer <token>');
    }

    const token = authHeader.substring(7);
    let payload: JwtPayload & { exp: number };

    // 1. Verify chu ky JWT
    try {
      const secret = this.config.getOrThrow<string>('JWT_SECRET');
      payload = this.jwtService.verify(token, { secret });
    } catch {
      throw new UnauthorizedException('JWT khong hop le hoac da het han.');
    }

    // 2. Kiem tra blacklist — neu user da logout thi token nay bi vo hieu
    if (payload.jti) {
      const blacklisted = await this.redisService.isJwtBlacklisted(payload.jti);
      if (blacklisted) {
        throw new UnauthorizedException('Token da bi thu hoi. Vui long dang nhap lai.');
      }
    }

    // Map sub → id sao cho tất cả controllers dùng user.id đều hoạt động.
    // sub = UUID của user trong PostgreSQL (set khi issue JWT).
    // Giữ nguyên tất cả field gốc (wallet, role, jti) để backward-compat.
    request['user'] = { ...payload, id: payload.sub };
    return true;
  }
}

// ─── RolesGuard ───────────────────────────────────────────────────────────────

@Injectable()
export class RolesGuard {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles?.length) return true;

    const user = context.switchToHttp().getRequest()['user'];
    if (!user) throw new UnauthorizedException('Chua xac thuc.');

    const hasRole = requiredRoles.some((role) => user.role === role);
    if (!hasRole) {
      throw new ForbiddenException(
        `Yeu cau role: [${requiredRoles.join(', ')}]. Ban co role: ${user.role}`,
      );
    }
    return true;
  }
}
