import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateChatTables1718380000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "chat_sessions" (
        "id"                 uuid DEFAULT gen_random_uuid() PRIMARY KEY,
        "user_id"            uuid NOT NULL,
        "status"             varchar(16) NOT NULL DEFAULT 'active',
        "escalation_reason"  text,
        "assigned_staff_id"  uuid,
        "created_at"         timestamp NOT NULL DEFAULT now(),
        "updated_at"         timestamp NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_chat_session_user" ON "chat_sessions" ("user_id")`);

    await queryRunner.query(`
      CREATE TABLE "chat_messages" (
        "id"          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
        "session_id"  uuid NOT NULL REFERENCES "chat_sessions"("id") ON DELETE CASCADE,
        "sender"      varchar(8) NOT NULL,
        "content"     text NOT NULL,
        "metadata"    jsonb,
        "created_at"  timestamp NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_chat_msg_session" ON "chat_messages" ("session_id", "created_at")`);

    await queryRunner.query(`
      CREATE TABLE "escalation_tickets" (
        "id"          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
        "session_id"  uuid NOT NULL REFERENCES "chat_sessions"("id") ON DELETE CASCADE,
        "user_id"     uuid NOT NULL,
        "status"      varchar(16) NOT NULL DEFAULT 'open',
        "priority"    varchar(8) NOT NULL DEFAULT 'medium',
        "summary"     text NOT NULL,
        "created_at"  timestamp NOT NULL DEFAULT now(),
        "resolved_at" timestamp
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_escalation_session" ON "escalation_tickets" ("session_id")`);
    await queryRunner.query(`CREATE INDEX "idx_escalation_status" ON "escalation_tickets" ("status")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "escalation_tickets"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "chat_messages"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "chat_sessions"`);
  }
}
