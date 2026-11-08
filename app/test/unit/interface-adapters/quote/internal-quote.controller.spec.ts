import { InternalQuoteController } from '@interface-adapters/quote/internal-quote.controller';

import { ICheckServiceQuoteUsageUseCase } from '@application/ports/input/quote/check-service-quote-usage.use-case.interface';
import { ICheckPartSupplyQuoteUsageUseCase } from '@application/ports/input/quote/check-part-supply-quote-usage.use-case.interface';

describe('InternalQuoteController', () => {
  let checkServiceQuoteUsageUseCase: jest.Mocked<ICheckServiceQuoteUsageUseCase>;
  let checkPartSupplyQuoteUsageUseCase: jest.Mocked<ICheckPartSupplyQuoteUsageUseCase>;
  let controller: InternalQuoteController;

  beforeEach(() => {
    checkServiceQuoteUsageUseCase = { execute: jest.fn() };

    checkPartSupplyQuoteUsageUseCase = { execute: jest.fn() };

    controller = new InternalQuoteController(
      checkServiceQuoteUsageUseCase,
      checkPartSupplyQuoteUsageUseCase,
    );
  });

  it('should answer whether a quote uses the service', async () => {
    checkServiceQuoteUsageUseCase.execute.mockResolvedValue(true);

    await expect(controller.findServiceQuoteUsage('service-id')).resolves.toEqual({
      data: { inUse: true },
    });

    expect(checkServiceQuoteUsageUseCase.execute).toHaveBeenCalledWith('service-id');
  });

  it('should answer whether a quote uses the part supply', async () => {
    checkPartSupplyQuoteUsageUseCase.execute.mockResolvedValue(false);

    await expect(controller.findPartSupplyQuoteUsage('part-supply-id')).resolves.toEqual({
      data: { inUse: false },
    });

    expect(checkPartSupplyQuoteUsageUseCase.execute).toHaveBeenCalledWith('part-supply-id');
  });
});
