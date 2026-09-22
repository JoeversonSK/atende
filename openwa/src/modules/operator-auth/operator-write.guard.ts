import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { OperatorAuthService } from './operator-auth.service';

/** In the Atende deployment, API keys alone never authorize employee writes. */
@Injectable()
export class OperatorWriteGuard implements CanActivate {
  constructor(private readonly auth: OperatorAuthService) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    if (['GET','HEAD','OPTIONS'].includes(request.method)) return true;
    if (process.env.ATENDE_REQUIRE_OPERATOR !== 'true') return true;
    const assigning = context.getClass().name === 'ConversationAssignmentController';
    const user = await this.auth.requirePermission(request.headers['x-atende-token'] || '', assigning ? 'canAssign' : 'canSend');
    if (assigning && request.method === 'PUT') {
      const target = await this.auth.assignmentTarget(request.headers['x-atende-token'] || '', request.body?.assigneeId || user.id);
      request.body.assigneeId = target.id;
      request.body.assigneeName = target.displayName;
    }
    return true;
  }
}
