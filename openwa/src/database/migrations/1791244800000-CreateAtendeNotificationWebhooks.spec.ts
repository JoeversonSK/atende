import { QueryRunner } from 'typeorm';
import { CreateAtendeNotificationWebhooks1791244800000 } from './1791244800000-CreateAtendeNotificationWebhooks';

describe('migração dos webhooks de notificação do Atende', () => {
  const migration = new CreateAtendeNotificationWebhooks1791244800000();

  it('cria a tabela no PostgreSQL de modo idempotente e sem apagar registros', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const runner = { dataSource: { options: { type: 'postgres' } }, query } as unknown as QueryRunner;
    await migration.up(runner);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain('CREATE TABLE IF NOT EXISTS openwa.notification_webhooks');
    await migration.down(runner);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('não executa SQL específico de PostgreSQL em SQLite', async () => {
    const query = jest.fn();
    const runner = { dataSource: { options: { type: 'better-sqlite3' } }, query } as unknown as QueryRunner;
    await migration.up(runner);
    expect(query).not.toHaveBeenCalled();
  });
});
