import { Body, Controller, Delete, Get, Headers, Param, Post, Put } from '@nestjs/common';
import { Public } from '../auth/decorators/auth.decorators';
import { OperatorAuthService } from '../operator-auth/operator-auth.service';
import { CreateWebhookDto, UpdateWebhookDto, WebhookResponseDto } from './dto';
import { WEBHOOK_EVENTS } from './dto/webhook.dto';
import { WebhookService } from './webhook.service';

/** Administração de integrações HTTP pela conta de administrador da central. */
@Public()
@Controller('operator-auth/admin/system-webhooks')
export class SystemWebhookController {
  constructor(private readonly auth: OperatorAuthService, private readonly webhooks: WebhookService) {}

  private async session(token: string) {
    await this.auth.requireAdmin(token);
    return (await this.auth.connectionContext(token)).sessionId;
  }

  @Get('catalog') async catalog(@Headers('x-atende-token') token = '') {
    await this.session(token);
    return { events: WEBHOOK_EVENTS };
  }
  @Get() async list(@Headers('x-atende-token') token = '') {
    return WebhookResponseDto.fromEntities(await this.webhooks.findBySession(await this.session(token)));
  }
  @Post() async create(@Headers('x-atende-token') token = '', @Body() dto: CreateWebhookDto) {
    return WebhookResponseDto.fromEntity(await this.webhooks.create(await this.session(token), dto));
  }
  @Put(':id') async update(@Headers('x-atende-token') token = '', @Param('id') id: string, @Body() dto: UpdateWebhookDto) {
    return WebhookResponseDto.fromEntity(await this.webhooks.update(await this.session(token), id, dto));
  }
  @Delete(':id') async remove(@Headers('x-atende-token') token = '', @Param('id') id: string) {
    await this.webhooks.delete(await this.session(token), id);
    return { success: true };
  }
  @Post(':id/test') async test(@Headers('x-atende-token') token = '', @Param('id') id: string) {
    return this.webhooks.test(await this.session(token), id);
  }
}
