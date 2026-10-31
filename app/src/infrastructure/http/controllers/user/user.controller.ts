import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiInternalServerErrorResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { Roles } from '@infrastructure/http/decorators/roles.decorator';
import { RolesGuard } from '@infrastructure/http/guards/roles.guard';
import { CurrentPrincipal } from '@infrastructure/http/decorators/current-principal.decorator';
import { AuthenticatedPrincipal } from '@application/auth/authenticated-principal';
import { UserRole } from '@domain/enums/user-role.enum';

import { UserController as UserCleanController } from '@interface-adapters/user/user.controller';

import { CreateUserRequestDto } from './dto/requests/create-user-request.dto';
import { FindAllUsersQueryDto } from './dto/requests/filter-users.dto';
import { UpdateUserStatusRequestDto } from './dto/requests/update-user-status-request.dto';
import { UpdateUserRequestDto } from './dto/requests/update-user-request.dto';
import { UserDataResponseDto, UserPaginatedResponseDto } from './dto/responses/user-response.dto';

@ApiTags('Gestão de Usuários')
@ApiProduces('application/json')
@ApiUnauthorizedResponse({ description: 'Não autenticado' })
@ApiInternalServerErrorResponse({ description: 'Erro interno do servidor' })
@Controller('users')
@UseGuards(RolesGuard)
@ApiBearerAuth('access-token')
export class UserController {
  constructor(private readonly controller: UserCleanController) {}

  @Post()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Criar novo usuário (somente Admin)' })
  @ApiCreatedResponse({ type: UserDataResponseDto, description: 'Usuário criado com sucesso' })
  @ApiBadRequestResponse({ description: 'Dados inválidos' })
  @ApiForbiddenResponse({ description: 'Acesso negado' })
  @ApiConflictResponse({ description: 'E-mail já cadastrado' })
  @ApiUnprocessableEntityResponse({ description: 'Erro de validação de domínio' })
  create(@Body() request: CreateUserRequestDto): Promise<UserDataResponseDto> {
    return this.controller.create(request);
  }

  @Get()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Listar usuários de forma paginada (somente Admin)' })
  @ApiOkResponse({ type: UserPaginatedResponseDto, description: 'Lista paginada de usuários' })
  @ApiForbiddenResponse({ description: 'Acesso negado' })
  findAll(@Query() query: FindAllUsersQueryDto): Promise<UserPaginatedResponseDto> {
    return this.controller.findAll(query);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Buscar usuário por ID (somente Admin)' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'ID do usuário' })
  @ApiOkResponse({ type: UserDataResponseDto, description: 'Usuário encontrado' })
  @ApiBadRequestResponse({ description: 'ID inválido (UUID esperado)' })
  @ApiForbiddenResponse({ description: 'Acesso negado' })
  @ApiNotFoundResponse({ description: 'Usuário não encontrado' })
  findById(@Param('id', ParseUUIDPipe) id: string): Promise<UserDataResponseDto> {
    return this.controller.findById(id);
  }

  @Put(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Atualizar dados do usuário (somente Admin)' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'ID do usuário' })
  @ApiOkResponse({ type: UserDataResponseDto, description: 'Usuário atualizado' })
  @ApiBadRequestResponse({ description: 'Dados inválidos ou ID com formato incorreto' })
  @ApiForbiddenResponse({ description: 'Acesso negado' })
  @ApiNotFoundResponse({ description: 'Usuário não encontrado' })
  @ApiConflictResponse({ description: 'E-mail já cadastrado' })
  @ApiUnprocessableEntityResponse({ description: 'Erro de validação de domínio' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() request: UpdateUserRequestDto,
  ): Promise<UserDataResponseDto> {
    return this.controller.update(id, request);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Alterar status do usuário (somente Admin)' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'ID do usuário' })
  @ApiOkResponse({ type: UserDataResponseDto, description: 'Status do usuário atualizado' })
  @ApiBadRequestResponse({ description: 'ID inválido (UUID esperado)' })
  @ApiForbiddenResponse({ description: 'Acesso negado' })
  @ApiNotFoundResponse({ description: 'Usuário não encontrado' })
  @ApiUnprocessableEntityResponse({ description: 'Usuário já está no status informado' })
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() request: UpdateUserStatusRequestDto,
  ): Promise<UserDataResponseDto> {
    return this.controller.updateStatus(id, request);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remover usuário (somente Admin)' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'ID do usuário' })
  @ApiNoContentResponse({ description: 'Usuário removido' })
  @ApiBadRequestResponse({ description: 'ID inválido (UUID esperado)' })
  @ApiForbiddenResponse({ description: 'Acesso negado' })
  @ApiNotFoundResponse({ description: 'Usuário não encontrado' })
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.controller.remove(id);
  }

  @Post(':userId/password-resets')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Emitir código de redefinição de senha para um usuário (somente Admin)',
  })
  @ApiParam({ name: 'userId', format: 'uuid', description: 'ID do usuário' })
  @ApiNoContentResponse({ description: 'Código de redefinição emitido e enviado por e-mail' })
  @ApiBadRequestResponse({ description: 'ID inválido (UUID esperado)' })
  @ApiForbiddenResponse({ description: 'Acesso negado' })
  @ApiNotFoundResponse({ description: 'Usuário não encontrado' })
  issuePasswordResetCode(
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ): Promise<void> {
    return this.controller.issuePasswordResetCode(userId, principal.sub);
  }
}
