import { ForbiddenException } from '@nestjs/common';
import { SystemWebhookController } from './system-webhook.controller';

describe('SystemWebhookController', () => {
  it('não expõe integrações a quem não é administrador', async () => {
    const auth = { requireAdmin: jest.fn().mockRejectedValue(new ForbiddenException()), connectionContext: jest.fn() };
    const webhooks = { findBySession: jest.fn() };
    const controller = new SystemWebhookController(auth as never, webhooks as never);
    await expect(controller.list('operador')).rejects.toBeInstanceOf(ForbiddenException);
    expect(webhooks.findBySession).not.toHaveBeenCalled();
  });

  it('usa apenas a sessão autorizada e apresenta o catálogo de eventos da central', async () => {
    const auth = { requireAdmin: jest.fn(), connectionContext: jest.fn().mockResolvedValue({ sessionId: 'sessao-atende' }) };
    const webhooks = { findBySession: jest.fn().mockResolvedValue([]) };
    const controller = new SystemWebhookController(auth as never, webhooks as never);
    expect(await controller.list('admin')).toEqual([]);
    expect(webhooks.findBySession).toHaveBeenCalledWith('sessao-atende');
    expect((await controller.catalog('admin')).events).toContain('contact.updated');
    expect((await controller.catalog('admin')).events).toContain('message.received');
  });
});
