import { IUserRepository } from '@domain/interfaces/repositories/user.repository.interface';
import { IUpdateUserStatusUseCase } from '@application/ports/input/user/update-user-status.use-case.interface';
import { ILogger } from '@application/ports/output/services/logger.service.interface';
import { BUSINESS_EVENTS } from '@application/logging/business-event.catalog';

import { UserPublicView } from '@domain/entities/user.entity';
import { ResourceNotFoundException } from '@application/exceptions/resource-not-found.exception';

export class UpdateUserStatusUseCase implements IUpdateUserStatusUseCase {
  constructor(
    private readonly userRepository: IUserRepository,
    private readonly logger: ILogger,
  ) {}

  async execute(id: string, active: boolean): Promise<UserPublicView> {
    const user = await this.userRepository.findById(id);

    if (!user) {
      throw new ResourceNotFoundException('Usuário', id);
    }

    if (active) {
      user.activate();
    } else {
      user.deactivate();
    }

    const updated = await this.userRepository.update(user);

    this.logger.event(BUSINESS_EVENTS.USER_STATUS_UPDATED, {
      targetUserId: updated.id,
      targetUserActive: updated.isActive,
    });

    return updated.toPublicView();
  }
}
