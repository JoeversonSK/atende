import { Global, Module } from '@nestjs/common';
import { OperatorAuthController } from './operator-auth.controller';
import { OperatorAuthService } from './operator-auth.service';
import { ContactProfileController, ContactProfileService } from './contact-profile.controller';
import { ContactImportController, ContactImportService } from './contact-import.controller';
import { TeamChatController, TeamChatService } from './team-chat.controller';
import { SheetAutomationController, SheetAutomationService } from './sheet-automation.controller';
@Global()
@Module({ controllers: [OperatorAuthController, ContactProfileController, ContactImportController, TeamChatController, SheetAutomationController], providers: [OperatorAuthService, ContactProfileService, ContactImportService, TeamChatService, SheetAutomationService], exports: [OperatorAuthService, ContactProfileService] }) export class OperatorAuthModule {}
