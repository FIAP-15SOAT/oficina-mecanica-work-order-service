export interface ServiceMetrics {
  serviceId: string;
  serviceName: string | null;
  executionCount: number;
  averageTimeMinutes: number;
}
