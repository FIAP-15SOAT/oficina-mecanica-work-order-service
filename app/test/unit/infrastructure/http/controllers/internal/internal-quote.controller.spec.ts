import { InternalQuoteController } from '@infrastructure/http/controllers/internal/internal-quote.controller';
import { InternalQuoteController as InternalQuoteCleanController } from '@interface-adapters/quote/internal-quote.controller';
import { QuotePresenter } from '@interface-adapters/quote/quote.presenter';

describe('InternalQuoteController (http)', () => {
  let cleanController: InternalQuoteCleanController;
  let httpController: InternalQuoteController;

  beforeEach(() => {
    cleanController = new InternalQuoteCleanController(
      { execute: jest.fn() },
      { execute: jest.fn() },
    );

    httpController = new InternalQuoteController(cleanController);
  });

  it('should delegate the service quote usage', async () => {
    const response = QuotePresenter.toInternalUsageDataResponse(true);

    jest.spyOn(cleanController, 'findServiceQuoteUsage').mockResolvedValue(response);

    await expect(httpController.findServiceQuoteUsage('service-id')).resolves.toBe(response);

    expect(cleanController.findServiceQuoteUsage).toHaveBeenCalledWith('service-id');
  });

  it('should delegate the part supply quote usage', async () => {
    const response = QuotePresenter.toInternalUsageDataResponse(false);

    jest.spyOn(cleanController, 'findPartSupplyQuoteUsage').mockResolvedValue(response);

    await expect(httpController.findPartSupplyQuoteUsage('part-supply-id')).resolves.toBe(response);

    expect(cleanController.findPartSupplyQuoteUsage).toHaveBeenCalledWith('part-supply-id');
  });
});
