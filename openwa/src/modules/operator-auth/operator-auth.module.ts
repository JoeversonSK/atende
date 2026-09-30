import { Global, Module } from '@nestjs/common';
import { OperatorAuthController } from './operator-auth.controller';
import { OperatorAuthService } from './operator-auth.service';
import { ContactProfileController, ContactProfileService } from './contact-profile.controller';
import { ContactImportController, ContactImportService } from './contact-import.controller';
import { TeamChatController, TeamChatService } from './team-chat.controller';
@Global()
@Module({ controllers: [OperatorAuthController, ContactProfileController, ContactImportController, TeamChatController], providers: [OperatorAuthService, ContactProfileService, ContactImportService, TeamChatService], exports: [OperatorAuthService, ContactProfileService] }) export class OperatorAuthModule {}
