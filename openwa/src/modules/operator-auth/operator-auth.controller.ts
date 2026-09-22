import { Body, Controller, Get, Headers, Param, Post, Put, Query } from '@nestjs/common';
import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { Public } from '../auth/decorators/auth.decorators';
import { OperatorAuthService } from './operator-auth.service';
class LoginDto { @IsString() @IsNotEmpty() @MaxLength(80) username!: string; @IsString() @MinLength(8) @MaxLength(128) password!: string; }
class RegisterDto extends LoginDto { @IsString() @IsNotEmpty() @MaxLength(160) displayName!: string; }
class ProfileDto { @IsString() @IsNotEmpty() @MaxLength(160) displayName!: string; }
class UserAccessDto { @IsIn(['admin','agent']) role!: string; @IsBoolean() active!: boolean; @IsBoolean() canSend!: boolean; @IsBoolean() canAssign!: boolean; }
class RecipientDto { @IsOptional() @IsUUID() userId?: string|null; }
class ResetPasswordDto extends LoginDto { @IsString() @MinLength(32) @MaxLength(128) code!: string; }
@Public() @Controller('operator-auth')
export class OperatorAuthController { constructor(private readonly auth: OperatorAuthService) {} @Post('register') register(@Body() dto: RegisterDto) { return this.auth.register(dto.username, dto.displayName, dto.password); } @Post('login') login(@Body() dto: LoginDto) { return this.auth.login(dto.username, dto.password); } @Get('me') me(@Headers('x-atende-token') token = '') { return this.auth.me(token); } @Put('me') update(@Headers('x-atende-token') token = '', @Body() dto: ProfileDto) { return this.auth.updateProfile(token, dto.displayName); } @Post('logout') async logout(@Headers('x-atende-token') token = '') { await this.auth.logout(token); return { success: true }; } 
  @Get('admin') administration(@Headers('x-atende-token') token='') { return this.auth.administration(token); }
  @Get('connection') async connection(@Headers('x-atende-token') token='') { const connection = await this.auth.connectionContext(token); return { sessionId: connection.sessionId }; }
  @Post('reset-password') resetPassword(@Body() dto: ResetPasswordDto) { return this.auth.resetPassword(dto.username,dto.code,dto.password); }
  @Put('admin/users/:id') updateUser(@Headers('x-atende-token') token='',@Param('id') id: string,@Body() dto: UserAccessDto) { return this.auth.updateUser(token,id,dto); }
  @Put('admin/notifications') recipient(@Headers('x-atende-token') token='',@Body() dto: RecipientDto) { return this.auth.setRecipient(token,dto.userId ?? null); }
  @Get('notification') notification(@Headers('x-atende-token') token='',@Query('sessionId') sessionId='',@Query('chatId') chatId='') { return this.auth.notification(token,sessionId,chatId); }
}
