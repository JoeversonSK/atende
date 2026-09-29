import { Global, Module } from '@nestjs/common';
import { OperatorAuthController } from './operator-auth.controller';
import { OperatorAuthService } from './operator-auth.service';
import { ContactProfileController, ContactProfileService } from './contact-profile.controller';
import { ContactImportController, ContactImportService } from './contact-import.controller';
@Global()
@Module({ controllers: [OperatorAuthController, ContactProfileController, ContactImportController], providers: [OperatorAuthService, ContactProfileService, ContactImportService], exports: [OperatorAuthService, ContactProfileService] }) export class OperatorAuthModule {}
