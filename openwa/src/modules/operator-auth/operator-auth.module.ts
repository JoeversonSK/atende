import { Global, Module } from '@nestjs/common';
import { OperatorAuthController } from './operator-auth.controller';
import { OperatorAuthService } from './operator-auth.service';
import { ContactProfileController, ContactProfileService } from './contact-profile.controller';
@Global()
@Module({ controllers: [OperatorAuthController, ContactProfileController], providers: [OperatorAuthService, ContactProfileService], exports: [OperatorAuthService, ContactProfileService] }) export class OperatorAuthModule {}
