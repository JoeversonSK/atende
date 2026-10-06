import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A tabela já era criada em dois serviços durante onModuleInit. A migração
 * assume a responsabilidade pelo esquema sem recriar nem alterar os dados
 * das instalações existentes.
 */
export class CreateAtendeNotificationWebhooks1791244800000 implements MigrationInterface {
  name = 'CreateAtendeNotificationWebhooks1791244800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.dataSource.options.type !== 'postgres') return;
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS openwa.notification_webhooks (
      id varchar(36) PRIMARY KEY,
      name varchar(100) NOT NULL,
      destination_type varchar(16) NOT NULL,
      url varchar(2048) NOT NULL,
      active boolean NOT NULL DEFAULT true,
      only_unassigned boolean NOT NULL DEFAULT true,
      include_groups boolean NOT NULL DEFAULT false,
      include_text boolean NOT NULL DEFAULT true,
      include_media boolean NOT NULL DEFAULT true,
      sender_name varchar(80) NOT NULL DEFAULT 'Atende',
      title varchar(120) NOT NULL DEFAULT 'Nova mensagem',
      color varchar(7) NOT NULL DEFAULT '#0b917a',
      fields jsonb NOT NULL DEFAULT '["contactName","phone","message","receivedAt"]'::jsonb,
      created_at timestamptz NOT NULL DEFAULT NOW(),
      updated_at timestamptz NOT NULL DEFAULT NOW()
    )`);
  }

  // Reverter código não pode apagar webhooks configurados pelos usuários.
  public async down(_queryRunner: QueryRunner): Promise<void> {}
}
