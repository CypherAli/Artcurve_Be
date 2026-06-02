// ─────────────────────────────────────────────────────────────────
//  common/decorators/index.ts
//  Global param + metadata decorators — usable in any module
// ─────────────────────────────────────────────────────────────────

import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common'

// ── @Public() ─────────────────────────────────────────────────────
// Mark a route as unauthenticated — JwtAuthGuard / Web3AuthGuard will skip it
export const IS_PUBLIC_KEY = 'isPublic'
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true)

// ── @Roles(...roles) ──────────────────────────────────────────────
// Restrict a route by user role, e.g. @Roles('admin')
export const ROLES_KEY = 'roles'
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles)

// ── @CurrentUser() ────────────────────────────────────────────────
// Extract JWT payload from request.user after guard validation
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest()
    return request['user']
  },
)

// ── @WsUser() ─────────────────────────────────────────────────────
// Extract user from socket.data.user in WebSocket handlers
export const WsUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const client = ctx.switchToWs().getClient()
    return client.data?.user ?? null
  },
)

// ── @ApiPagination() ──────────────────────────────────────────────
// Convenience metadata for swagger pagination docs
export const API_PAGINATION_KEY = 'apiPagination'
export const ApiPagination = () => SetMetadata(API_PAGINATION_KEY, true)
