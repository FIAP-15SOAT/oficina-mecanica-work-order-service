import {
  FindCatalogItemsInputDto,
  FindCatalogItemsOutputDto,
} from '@application/ports/input/catalog/dto/find-catalog-items.dto';

export interface IFindCatalogItemsUseCase {
  execute(input: FindCatalogItemsInputDto): Promise<FindCatalogItemsOutputDto>;
}
