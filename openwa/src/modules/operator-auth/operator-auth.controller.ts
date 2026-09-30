import { Body, Controller, Delete, Get, Headers, Param, Post, Put, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsHexColor, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUrl, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { Public } from '../auth/decorators/auth.decorators';
import { OperatorAuthService } from './operator-auth.service';
class LoginDto { @IsString() @IsNotEmpty() @MaxLength(80) username!: string; @IsString() @MinLength(8) @MaxLength(128) password!: string; }
class RegisterDto extends LoginDto { @IsString() @IsNotEmpty() @MaxLength(160) displayName!: string; }
class ProfileDto { @IsString() @IsNotEmpty() @MaxLength(160) displayName!: string; }
class QuickReplyDto { @IsString() @IsNotEmpty() @MaxLength(61) shortcut!:string; @IsString() @IsNotEmpty() @MaxLength(10000) text!:string; }
class UserAccessDto { @IsIn(['admin','agent']) role!: string; @IsBoolean() active!: boolean; @IsBoolean() canSend!: boolean; @IsBoolean() canAssign!: boolean; @IsBoolean() dashboardVisible!: boolean; }
class RecipientDto { @IsArray() @ArrayMaxSize(100) @IsUUID('4',{each:true}) userIds!: string[]; }
class ResetPasswordDto extends LoginDto { @IsString() @MinLength(32) @MaxLength(128) code!: string; }
class OperationIntervalDto { @IsString() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) start!: string; @IsString() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) end!: string; }
class OperationDayDto { @IsInt() @Min(0) @Max(6) weekday!: number; @IsBoolean() enabled!: boolean; @IsArray() @ValidateNested({each:true}) @Type(()=>OperationIntervalDto) intervals!: OperationIntervalDto[]; }
class OperationHoursDto { @IsBoolean() enabled!: boolean; @IsArray() @ValidateNested({each:true}) @Type(()=>OperationDayDto) days!: OperationDayDto[]; }
class NotificationWebhookDto {
  @IsString() @IsNotEmpty() @MaxLength(100) name!:string;
  @IsIn(['discord','json']) destinationType!:'discord'|'json';
  @IsUrl({protocols:['https'],require_protocol:true,require_tld:false}) @MaxLength(2048) url!:string;
  @IsBoolean() active!:boolean;
  @IsBoolean() onlyUnassigned!:boolean;
  @IsBoolean() includeGroups!:boolean;
  @IsBoolean() includeText!:boolean;
  @IsBoolean() includeMedia!:boolean;
  @IsString() @MaxLength(80) senderName!:string;
  @IsString() @MaxLength(120) title!:string;
  @IsHexColor() color!:string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(5) @IsIn(['contactName','phone','message','messageType','receivedAt'],{each:true}) fields!:string[];
}
export class ConversationFlowStepDto {
  @IsOptional() @IsString() @MaxLength(80) id?:string;
  @IsOptional() @IsIn(['message','image','video','audio','document','poll','delay','action']) type?:'message'|'image'|'video'|'audio'|'document'|'poll'|'delay'|'action';
  @IsOptional() @IsString() @MaxLength(4000) text?:string;
  @IsOptional() @IsInt() @Min(0) @Max(3600) delaySeconds?:number;
  @IsOptional() @IsString() data?:string;
  @IsOptional() @IsString() @MaxLength(160) mimetype?:string;
  @IsOptional() @IsString() @MaxLength(240) filename?:string;
  @IsOptional() @IsString() @MaxLength(1024) caption?:string;
  @IsOptional() @IsString() @MaxLength(255) question?:string;
  @IsOptional() @IsArray() @ArrayMinSize(0) @ArrayMaxSize(12) @IsString({each:true}) @MaxLength(100,{each:true}) options?:string[];
  @IsOptional() @IsBoolean() allowMultipleAnswers?:boolean;
  @IsOptional() @IsIn(['assign-current','close-ticket']) action?:'assign-current'|'close-ticket';
}
export class ConversationFlowDto { @IsString() @IsNotEmpty() @MaxLength(100) name!: string; @IsOptional() @IsString() @MaxLength(240) description?: string; @IsBoolean() active!: boolean; @IsIn(['regular','start','evaluation']) kind!: 'regular'|'start'|'evaluation'; @IsArray() @ValidateNested({each:true}) @Type(()=>ConversationFlowStepDto) steps!: ConversationFlowStepDto[]; @IsArray() @ArrayMinSize(0) @ArrayMaxSize(12) @IsString({each:true}) @MaxLength(100,{each:true}) pollOptions!: string[]; }
@Public() @Controller('operator-auth')
export class OperatorAuthController { constructor(private readonly auth: OperatorAuthService) {} @Post('register') register(@Body() dto: RegisterDto) { return this.auth.register(dto.username, dto.displayName, dto.password); } @Post('login') login(@Body() dto: LoginDto) { return this.auth.login(dto.username, dto.password); } @Get('me') me(@Headers('x-atende-token') token = '') { return this.auth.me(token); } @Put('me') update(@Headers('x-atende-token') token = '', @Body() dto: ProfileDto) { return this.auth.updateProfile(token, dto.displayName); } @Post('logout') async logout(@Headers('x-atende-token') token = '') { await this.auth.logout(token); return { success: true }; } 
  @Get('admin') administration(@Headers('x-atende-token') token='') { return this.auth.administration(token); }
  @Get('connection') async connection(@Headers('x-atende-token') token='') { const connection = await this.auth.connectionContext(token); return { sessionId: connection.sessionId }; }
  @Post('reset-password') resetPassword(@Body() dto: ResetPasswordDto) { return this.auth.resetPassword(dto.username,dto.code,dto.password); }
  @Put('admin/users/:id') updateUser(@Headers('x-atende-token') token='',@Param('id') id: string,@Body() dto: UserAccessDto) { return this.auth.updateUser(token,id,dto); }
  @Put('admin/notifications') recipient(@Headers('x-atende-token') token='',@Body() dto: RecipientDto) { return this.auth.setRecipients(token,dto.userIds); }
  @Get('operation-hours') operationHours(@Headers('x-atende-token') token='') { return this.auth.operationHours(token); }
  @Put('admin/operation-hours') updateOperationHours(@Headers('x-atende-token') token='',@Body() dto: OperationHoursDto) { return this.auth.updateOperationHours(token,dto); }
  @Get('flows') flows(@Headers('x-atende-token') token='') { return this.auth.conversationFlows(token); }
  @Get('quick-replies') quickReplies(@Headers('x-atende-token') token='') { return this.auth.quickReplies(token); }
  @Post('admin/quick-replies') createQuickReply(@Headers('x-atende-token') token='',@Body() dto:QuickReplyDto) { return this.auth.saveQuickReply(token,undefined,dto); }
  @Put('admin/quick-replies/:id') updateQuickReply(@Headers('x-atende-token') token='',@Param('id') id:string,@Body() dto:QuickReplyDto) { return this.auth.saveQuickReply(token,id,dto); }
  @Delete('admin/quick-replies/:id') deleteQuickReply(@Headers('x-atende-token') token='',@Param('id') id:string) { return this.auth.deleteQuickReply(token,id); }
  @Post('admin/flows') createFlow(@Headers('x-atende-token') token='',@Body() dto: ConversationFlowDto) { return this.auth.createConversationFlow(token,dto); }
  @Put('admin/flows/:id') updateFlow(@Headers('x-atende-token') token='',@Param('id') id:string,@Body() dto: ConversationFlowDto) { return this.auth.updateConversationFlow(token,id,dto); }
  @Delete('admin/flows/:id') deleteFlow(@Headers('x-atende-token') token='',@Param('id') id:string) { return this.auth.deleteConversationFlow(token,id); }
  @Get('admin/notification-webhooks') notificationWebhooks(@Headers('x-atende-token') token='') { return this.auth.notificationWebhooks(token); }
  @Post('admin/notification-webhooks') createNotificationWebhook(@Headers('x-atende-token') token='',@Body() dto:NotificationWebhookDto) { return this.auth.createNotificationWebhook(token,dto); }
  @Put('admin/notification-webhooks/:id') updateNotificationWebhook(@Headers('x-atende-token') token='',@Param('id') id:string,@Body() dto:NotificationWebhookDto) { return this.auth.updateNotificationWebhook(token,id,dto); }
  @Delete('admin/notification-webhooks/:id') deleteNotificationWebhook(@Headers('x-atende-token') token='',@Param('id') id:string) { return this.auth.deleteNotificationWebhook(token,id); }
  @Post('admin/notification-webhooks/:id/test') testNotificationWebhook(@Headers('x-atende-token') token='',@Param('id') id:string) { return this.auth.testNotificationWebhook(token,id); }
  @Get('notification') notification(@Headers('x-atende-token') token='',@Query('sessionId') sessionId='',@Query('chatId') chatId='') { return this.auth.notification(token,sessionId,chatId); }
}
