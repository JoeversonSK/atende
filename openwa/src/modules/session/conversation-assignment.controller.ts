import { Body, ConflictException, Controller, Delete, Get, Param, Put, UseGuards } from '@nestjs/common';
import { OperatorWriteGuard } from '../operator-auth/operator-write.guard';
import { InjectRepository } from '@nestjs/typeorm';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { Repository } from 'typeorm';
import { RequireRole, SessionScoped } from '../auth/decorators/auth.decorators';
import { ApiKeyRole } from '../auth/entities/api-key.entity';
import { Session } from './entities/session.entity';

class AssignConversationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  assigneeName!: string;
  @IsString()
  @IsNotEmpty()
  @MaxLength(36)
  assigneeId!: string;
}

@ApiTags('conversation assignments')
@Controller('sessions/:sessionId/conversations')
@UseGuards(OperatorWriteGuard)
@SessionScoped()
@RequireRole(ApiKeyRole.OPERATOR)
export class ConversationAssignmentController {
  constructor(@InjectRepository(Session, 'data') private readonly sessions: Repository<Session>) {}

  @Get('assignments')
  async listAssignments(@Param('sessionId') sessionId: string) {
    return this.sessions.query(
      'SELECT a.chat_id AS "chatId", COALESCE(u.display_name, a.assignee_name) AS "assigneeName", a.assignee_id AS "assigneeId", a.updated_at AS "updatedAt" FROM openwa.conversation_assignments a LEFT JOIN openwa.operator_users u ON u.id = a.assignee_id WHERE a.session_id = $1',
      [sessionId],
    );
  }

  @Get(':chatId/assignment')
  @ApiOperation({ summary: 'Get the operator assigned to a conversation' })
  @ApiParam({ name: 'sessionId' })
  @ApiParam({ name: 'chatId' })
  async getAssignment(@Param('sessionId') sessionId: string, @Param('chatId') chatId: string) {
    const rows = await this.sessions.query(
      'SELECT assignee_name AS "assigneeName", assignee_id AS "assigneeId", updated_at AS "updatedAt" FROM openwa.conversation_assignments WHERE session_id = $1 AND chat_id = $2',
      [sessionId, chatId],
    );
    return rows[0] ?? null;
  }

  @Put(':chatId/assignment')
  @ApiOperation({ summary: 'Assign a conversation to an operator' })
  async assign(
    @Param('sessionId') sessionId: string,
    @Param('chatId') chatId: string,
    @Body() dto: AssignConversationDto,
  ) {
    const assigneeName = dto.assigneeName.trim();
    return this.sessions.manager.transaction(async db => {
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify([sessionId,chatId])]);
    const [profile]=await db.query('SELECT data FROM openwa.contact_profiles WHERE session_id=$1 AND chat_id=$2',[sessionId,chatId]);
    if (profile?.data?.status==='closed') throw new ConflictException('Reabra o atendimento no perfil antes de atribuí-lo.');
    const rows = await db.query(
      'INSERT INTO openwa.conversation_assignments (session_id, chat_id, assignee_name, assignee_id, updated_at) VALUES ($1, $2, $3, $4, NOW()) ON CONFLICT (session_id, chat_id) DO UPDATE SET assignee_name = EXCLUDED.assignee_name, updated_at = CASE WHEN openwa.conversation_assignments.assignee_id IS DISTINCT FROM EXCLUDED.assignee_id THEN NOW() ELSE openwa.conversation_assignments.updated_at END, assignee_id = EXCLUDED.assignee_id RETURNING assignee_name AS "assigneeName", assignee_id AS "assigneeId", updated_at AS "updatedAt"',
      [sessionId, chatId, assigneeName, dto.assigneeId.trim()],
    );
    return rows[0];
    });
  }

  @Delete(':chatId/assignment')
  @ApiOperation({ summary: 'Remove the operator assigned to a conversation' })
  async clear(@Param('sessionId') sessionId: string, @Param('chatId') chatId: string) {
    await this.sessions.query('DELETE FROM openwa.conversation_assignments WHERE session_id = $1 AND chat_id = $2', [sessionId, chatId]);
    return { success: true };
  }
}
