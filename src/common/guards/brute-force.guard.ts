import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { SecurityService } from '../../modules/security/security.service';

@Injectable()
export class BruteForceGuard implements CanActivate {
  constructor(private readonly securityService: SecurityService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const ip = request.ip || request.connection?.remoteAddress || 'unknown';

    if (await this.securityService.isBlocked(ip)) {
      await this.securityService.log({
        event_type: 'BRUTE_FORCE_BLOCKED',
        ip_address: ip,
        severity: 'WARNING',
        metadata: { reason: 'IP temporarily blocked' },
      });
      throw new ForbiddenException('Too many failed attempts. Try again later.');
    }
    return true;
  }
}
