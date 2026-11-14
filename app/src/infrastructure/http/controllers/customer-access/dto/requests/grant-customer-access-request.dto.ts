import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsEmail, MaxLength, MinLength } from 'class-validator';

import { MAX_NAME_LENGTH, MIN_NAME_LENGTH } from '@domain/constants/validation/customer.constants';
import { IsValidCpfCnpj } from '@infrastructure/http/validators/document.validator';

export class GrantCustomerAccessRequestDto {
  @ApiPropertyOptional({
    example: 'João Silva',
    description: 'Nome do operador (obrigatório para cliente COMPANY)',
  })
  @IsOptional()
  @IsString({ message: 'O nome deve ser um texto.' })
  @MinLength(MIN_NAME_LENGTH, {
    message: `O nome deve ter no mínimo ${MIN_NAME_LENGTH} caracteres`,
  })
  @MaxLength(MAX_NAME_LENGTH, { message: 'O nome deve ter no máximo 150 caracteres.' })
  name?: string;

  @ApiPropertyOptional({
    example: 'joao@email.com',
    description: 'E-mail do operador (obrigatório para cliente COMPANY)',
  })
  @IsOptional()
  @IsEmail({}, { message: 'E-mail inválido.' })
  email?: string;

  @ApiPropertyOptional({
    example: '123.456.789-09',
    description: 'CPF do operador (obrigatório para cliente COMPANY)',
  })
  @IsOptional()
  @IsString({ message: 'O CPF deve ser um texto.' })
  // A valid CNPJ passes here and the identity refuses it as an invalid CPF (422).
  @IsValidCpfCnpj({ message: 'CPF inválido' })
  cpf?: string;
}
