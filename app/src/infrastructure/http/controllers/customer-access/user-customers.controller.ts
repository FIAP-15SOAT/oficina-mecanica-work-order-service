import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';

import { RolesGuard } from '@infrastructure/http/guards/roles.guard';
import { Roles } from '@infrastructure/http/decorators/roles.decorator';
import { UserRole } from '@domain/enums/user-role.enum';

import { CustomerAccessController as CustomerAccessCleanController } from '@interface-adapters/customer-access/customer-access.controller';
import { LinkedCustomerListResponseDto } from './dto/responses/customer-access-response.dto';

@ApiTags('Acesso Externo de Clientes')
@ApiProduces('application/json')
@ApiInternalServerErrorResponse({ description: 'Erro interno do servidor' })
@ApiBearerAuth('access-token')
@UseGuards(RolesGuard)
@Controller('users')
export class UserCustomersController {
  constructor(private readonly controller: CustomerAccessCleanController) {}

  @Get(':userId/customers')
  @Roles(UserRole.ADMIN, UserRole.ATTENDANT)
  @ApiOperation({ summary: 'Listar clientes vinculados a um usuário' })
  @ApiParam({ name: 'userId', format: 'uuid' })
  @ApiOkResponse({ type: LinkedCustomerListResponseDto })
  @ApiNotFoundResponse({ description: 'Usuário não encontrado' })
  listUserCustomers(
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<LinkedCustomerListResponseDto> {
    return this.controller.listUserCustomers(userId);
  }
}
