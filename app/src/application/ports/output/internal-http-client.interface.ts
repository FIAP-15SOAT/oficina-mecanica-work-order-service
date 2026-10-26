export interface InternalRequest {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  body?: unknown;
  timeoutMs?: number;
}

export interface IInternalHttpClient {
  request<T>(request: InternalRequest): Promise<T>;
}
