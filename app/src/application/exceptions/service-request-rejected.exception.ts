import { ApplicationException } from './application.exception';

export class ServiceRequestRejectedException extends ApplicationException {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
