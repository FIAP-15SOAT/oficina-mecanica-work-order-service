import { ApiProperty } from '@nestjs/swagger';
import {
  AccessUserListResponse,
  CustomerAccessDataResponse,
  CustomerAccessResponse,
  LinkedCustomerListResponse,
} from '@interface-adapters/customer-access/responses/customer-access.response';
import { AccessUserOutputDto } from '@application/ports/input/customer-access/dto/grant-customer-access.dto';
import { UserRole } from '@domain/enums/user-role.enum';
import { CustomerType } from '@domain/enums/customer-type.enum';

export class AccessUserResponseDto implements AccessUserOutputDto {
  @ApiProperty({
    format: 'uuid',
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'ID do usuário',
  })
  id!: string;

  @ApiProperty({ example: 'João Silva', description: 'Nome do usuário' })
  name!: string;

  @ApiProperty({ example: 'joao@email.com', description: 'E-mail do usuário' })
  email!: string;

  @ApiProperty({
    enum: UserRole,
    example: UserRole.ATTENDANT,
    nullable: true,
    description: 'Papel do usuário — null para usuários externos (Cliente da Oficina)',
  })
  role!: UserRole | null;

  @ApiProperty({ example: true, description: 'Indica se o usuário está ativo' })
  isActive!: boolean;
}

export class AccessUserListResponseDto implements AccessUserListResponse {
  @ApiProperty({
    type: [AccessUserResponseDto],
    description: 'Usuários com acesso ao cliente',
  })
  data!: AccessUserResponseDto[];
}

export class LinkedCustomerResponseDto {
  @ApiProperty({
    format: 'uuid',
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'ID do cliente',
  })
  id!: string;

  @ApiProperty({ example: 'João da Silva', description: 'Nome do cliente' })
  name!: string;

  @ApiProperty({
    enum: CustomerType,
    example: CustomerType.INDIVIDUAL,
    description: 'Tipo do cliente',
  })
  type!: CustomerType;

  @ApiProperty({ example: true, description: 'Indica se o cliente está ativo' })
  isActive!: boolean;
}

export class LinkedCustomerListResponseDto implements LinkedCustomerListResponse {
  @ApiProperty({
    type: [LinkedCustomerResponseDto],
    description: 'Clientes vinculados ao usuário',
  })
  data!: LinkedCustomerResponseDto[];
}

export class CustomerAccessResponseDto implements CustomerAccessResponse {
  @ApiProperty({ type: AccessUserResponseDto, description: 'Usuário criado ou vinculado' })
  user!: AccessUserResponseDto;

  @ApiProperty({
    type: LinkedCustomerResponseDto,
    description: 'Cliente ao qual o acesso foi concedido',
  })
  customer!: LinkedCustomerResponseDto;

  @ApiProperty({
    example: true,
    description:
      'Indica se o usuário foi criado nesta concessão; nesse caso, ele recebe a senha inicial por e-mail',
  })
  initialPasswordSent!: boolean;
}

export class CustomerAccessDataResponseDto implements CustomerAccessDataResponse {
  @ApiProperty({ type: CustomerAccessResponseDto, description: 'Dados do acesso concedido' })
  data!: CustomerAccessResponseDto;
}
