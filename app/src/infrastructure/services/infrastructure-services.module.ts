import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { BcryptHashService } from './bcrypt-hash.service';
import { JwtTokenService } from './jwt-token.service';
import { MailerEmailSenderService } from './mailer-email-sender.service';

@Module({
  imports: [JwtModule.register({})],
  providers: [
    { provide: 'IHashService', useClass: BcryptHashService },
    { provide: 'ITokenService', useClass: JwtTokenService },
    { provide: 'IEmailSenderService', useClass: MailerEmailSenderService },
  ],
  exports: ['IHashService', 'ITokenService', 'IEmailSenderService'],
})
export class InfrastructureServicesModule {}
