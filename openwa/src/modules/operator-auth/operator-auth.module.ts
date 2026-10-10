import { Global, Module } from '@nestjs/common';
import { OperatorAuthController } from './operator-auth.controller';
import { OperatorAuthService } from './operator-auth.service';
import { ContactProfileController, ContactProfileService } from './contact-profile.controller';
import { ContactImportController, ContactImportService } from './contact-import.controller';
import { ContactCnpjImportController, ContactCnpjImportService } from './contact-cnpj-import.controller';
import { TeamChatController, TeamChatService } from './team-chat.controller';
import { SheetAutomationController, SheetAutomationService } from './sheet-automation.controller';
import { FlowSheetController, FlowSheetService } from './flow-sheet.service';
import { RobotAutomationController } from './robot-automation.controller';
import { RobotAutomationService } from './robot-automation.service';
import { WebhookModule } from '../webhook/webhook.module';
import { SystemWebhookController } from '../webhook/system-webhook.controller';
@Global()
@Module({ imports: [WebhookModule], controllers: [OperatorAuthController, ContactProfileController, ContactImportController, ContactCnpjImportController, TeamChatController, SheetAutomationController, FlowSheetController, RobotAutomationController, SystemWebhookController], providers: [OperatorAuthService, ContactProfileService, ContactImportService, ContactCnpjImportService, TeamChatService, SheetAutomationService, FlowSheetService, RobotAutomationService, {provide:'FLOW_SHEET_SERVICE',useExisting:FlowSheetService}], exports: [OperatorAuthService, ContactProfileService, RobotAutomationService] }) export class OperatorAuthModule {}
