/**
 * Pagination metadata returned by the use cases.
 */
export interface PaginationMeta {
  totalRecords: number;
  totalPages: number;
  page: number;
  limit: number;
}

/**
 * Generic paginated result returned by the use cases.
 */
export interface PaginatedResult<T> {
  items: T[];
  pagination: PaginationMeta;
}

/**
 * Base pagination input. Every paginated input DTO must extend this interface.
 */
export interface PaginationInput {
  page: number;
  limit: number;
}

/**
 * Optional pagination input (listing query); the controller applies the defaults.
 */
export interface PaginationQuery {
  page?: number;
  limit?: number;
}

/**
 * Paginated result returned by the repositories.
 */
export interface PaginatedRepositoryResult<T> {
  items: T[];
  total: number;
}
