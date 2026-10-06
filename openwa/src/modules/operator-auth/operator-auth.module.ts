import { Global, Module } from '@nestjs/common';
import { OperatorAuthController } from './operator-auth.controller';
import { OperatorAuthService } from './operator-auth.service';
import { ContactProfileController, ContactProfileService } from './contact-profile.controller';
import { ContactImportController, ContactImportService } from './contact-import.controller';
import { TeamChatController, TeamChatService } from './team-chat.controller';
import { SheetAutomationController, SheetAutomationService } from './sheet-automation.controller';
import { WebhookModule } from '../webhook/webhook.module';
import { SystemWebhookController } from '../webhook/system-webhook.controller';
@Global()
@Module({ imports: [WebhookModule], controllers: [OperatorAuthController, ContactProfileController, ContactImportController, TeamChatController, SheetAutomationController, SystemWebhookController], providers: [OperatorAuthService, ContactProfileService, ContactImportService, TeamChatService, SheetAutomationService], exports: [OperatorAuthService, ContactProfileService] }) export class OperatorAuthModule {}
