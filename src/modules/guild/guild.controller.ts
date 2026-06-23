import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { GuildService } from './guild.service';
import { CreateGuildDto } from './dto/create-guild.dto';
import { UpdateGuildDto } from './dto/update-guild.dto';
import { CreateGuildMessageDto } from './dto/guild-message.dto';
import { CurrentUser, Public } from '../../common/decorators';
import { JwtPayload } from '../auth/auth.service';
import { GuildRole } from './entities/guild-member.entity';

@ApiTags('guilds')
@Controller('guilds')
export class GuildController {
  constructor(private readonly guildService: GuildService) {}

  // ── Create guild ──────────────────────────────────────────────────────────

  @Post()
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Create a new guild' })
  create(@Body() dto: CreateGuildDto, @CurrentUser() user: JwtPayload) {
    return this.guildService.createGuild(user.sub, user.wallet, dto);
  }

  // ── List all guilds ───────────────────────────────────────────────────────

  @Get()
  @Public()
  @ApiOperation({ summary: 'List all guilds (paginated)' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  findAll(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.guildService.listGuilds(page ? +page : 1, limit ? +limit : 20);
  }

  // ── My guilds ─────────────────────────────────────────────────────────────

  @Get('my')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'List guilds the current user belongs to' })
  myGuilds(@CurrentUser() user: JwtPayload) {
    return this.guildService.myGuilds(user.sub);
  }

  // ── Guild detail ──────────────────────────────────────────────────────────

  @Get(':id')
  @Public()
  @ApiOperation({ summary: 'Get guild detail' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.guildService.getGuild(id);
  }

  // ── Update guild settings ─────────────────────────────────────────────────

  @Patch(':id')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Update guild settings (owner only)' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGuildDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.guildService.updateGuild(id, user.sub, dto);
  }

  // ── Delete guild ──────────────────────────────────────────────────────────

  @Delete(':id')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Delete guild (owner only)' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.guildService.deleteGuild(id, user.sub);
  }

  // ── Join guild ────────────────────────────────────────────────────────────

  @Post(':id/join')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Join a guild' })
  join(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.guildService.joinGuild(id, user.sub);
  }

  // ── Leave guild ───────────────────────────────────────────────────────────

  @Delete(':id/leave')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Leave a guild' })
  leave(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.guildService.leaveGuild(id, user.sub);
  }

  // ── Members ───────────────────────────────────────────────────────────────

  @Get(':id/members')
  @Public()
  @ApiOperation({ summary: 'List guild members (paginated)' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  members(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.guildService.getMembers(id, page ? +page : 1, limit ? +limit : 30);
  }

  // ── Kick member ───────────────────────────────────────────────────────────

  @Delete(':id/members/:userId')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Kick a member (owner/moderator)' })
  kick(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.guildService.kickMember(id, user.sub, userId);
  }

  // ── Change member role ────────────────────────────────────────────────────

  @Patch(':id/members/:userId/role')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Change member role (owner only)' })
  changeRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body('role') role: GuildRole,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.guildService.changeMemberRole(id, user.sub, userId, role);
  }

  // ── Transfer ownership ────────────────────────────────────────────────────

  @Post(':id/transfer')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Transfer guild ownership (owner only)' })
  transfer(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('userId') newOwnerId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.guildService.transferOwnership(id, user.sub, newOwnerId);
  }

  // ── Post message ──────────────────────────────────────────────────────────

  @Post(':id/messages')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Post a message to guild chat' })
  postMessage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateGuildMessageDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.guildService.postMessage(id, user.sub, user.wallet, dto.content);
  }

  // ── Delete message ────────────────────────────────────────────────────────

  @Delete(':id/messages/:messageId')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Delete a message (author/moderator/owner)' })
  deleteMessage(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.guildService.deleteMessage(id, messageId, user.sub);
  }

  // ── Get messages ──────────────────────────────────────────────────────────

  @Get(':id/messages')
  @Public()
  @ApiOperation({ summary: 'Get guild messages (cursor-based)' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'before', required: false, type: String, description: 'ISO date cursor' })
  getMessages(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('limit') limit?: number,
    @Query('before') before?: string,
  ) {
    return this.guildService.getMessages(id, limit ? +limit : 50, before);
  }

  // ── Collective holdings ───────────────────────────────────────────────────

  @Get(':id/holdings')
  @Public()
  @ApiOperation({ summary: 'Aggregated portfolio holdings of all guild members' })
  holdings(@Param('id', ParseUUIDPipe) id: string) {
    return this.guildService.getHoldings(id);
  }
}
