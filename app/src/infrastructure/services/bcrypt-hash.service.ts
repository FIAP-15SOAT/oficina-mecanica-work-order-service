import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { IHashService } from '@application/ports/output/services/hash.service.interface';

@Injectable()
export class BcryptHashService implements IHashService {
  private readonly saltRounds: number;

  constructor(configService: ConfigService) {
    this.saltRounds = Number(configService.get<number>('BCRYPT_SALT_ROUNDS', 12));
  }

  async hash(value: string): Promise<string> {
    return bcrypt.hash(value, this.saltRounds);
  }

  async compare(value: string, hashed: string): Promise<boolean> {
    return bcrypt.compare(value, hashed);
  }
}
