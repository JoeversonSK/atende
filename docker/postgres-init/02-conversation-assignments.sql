CREATE TABLE IF NOT EXISTS openwa.conversation_assignments (
  session_id varchar(255) NOT NULL,
  chat_id varchar(255) NOT NULL,
  assignee_name varchar(160) NOT NULL,
  assignee_id varchar(36),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (session_id, chat_id)
);
ALTER TABLE openwa.conversation_assignments ADD COLUMN IF NOT EXISTS assignee_id varchar(36);
