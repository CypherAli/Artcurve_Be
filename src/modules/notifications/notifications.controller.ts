import {
  Controller, Get, Patch, Delete,
  Param, Query, HttpCode, HttpStatus, ParseUUIDPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { CurrentUser } from '../auth/decorators';
import type { JwtPayload } from '../auth/auth.service';

@ApiTags('Notifications')
@ApiBearerAuth('JWT-auth')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  // GET /notifications?limit=50
  @Get()
  @ApiOperation({ summary: 'Lấy danh sách thông báo của user hiện tại' })
  async list(
    @CurrentUser() user: JwtPayload,
    @Query('limit') limit?: string,
  ) {
    const lim = Math.min(parseInt(limit ?? '50', 10) || 50, 100);
    return this.svc.findForUser(user.sub, lim);
  }

  // GET /notifications/unread-count
  @Get('unread-count')
  @ApiOperation({ summary: 'Số thông báo chưa đọc' })
  async unreadCount(@CurrentUser() user: JwtPayload) {
    const count = await this.svc.unreadCount(user.sub);
    return { count };
  }

  // PATCH /notifications/read-all
  @Patch('read-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Đánh dấu tất cả đã đọc' })
  async markAllRead(@CurrentUser() user: JwtPayload) {
    await this.svc.markAllRead(user.sub);
  }

  // PATCH /notifications/:id/read
  @Patch(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Đánh dấu 1 thông báo đã đọc' })
  async markRead(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.svc.markRead(id, user.sub);
  }

  // DELETE /notifications
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Xoá tất cả thông báo' })
  async clearAll(@CurrentUser() user: JwtPayload) {
    await this.svc.clearAll(user.sub);
  }

  // DELETE /notifications/:id
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Xoá 1 thông báo' })
  async deleteOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.svc.deleteOne(id, user.sub);
  }
}
