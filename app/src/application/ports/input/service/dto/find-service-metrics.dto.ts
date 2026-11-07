export interface ServiceMetrics {
  serviceId: string;
  serviceName: string;
  executionCount: number;
  averageTimeMinutes: number | null;
}
