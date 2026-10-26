import { SNSClient } from '@aws-sdk/client-sns';
import { SQSClient } from '@aws-sdk/client-sqs';

// Without a timeout a black-holed endpoint hangs the call, the relay batch and the shutdown that
// waits for it; without throwOnRequestTimeout the SDK only writes a warning to the console.
export const SNS_REQUEST_TIMEOUT_MS = 2_000;

// Above the 20 s long poll, which holds the ReceiveMessage request open by design.
export const SQS_REQUEST_TIMEOUT_MS = 25_000;

// Region, credentials and endpoint come from the environment (AWS_REGION, AWS_ENDPOINT_URL).
export function createSnsClient(): SNSClient {
  // The relay retries on its next tick; SDK retries would multiply the timeout inside the batch.
  return new SNSClient({
    maxAttempts: 1,
    requestHandler: { requestTimeout: SNS_REQUEST_TIMEOUT_MS, throwOnRequestTimeout: true },
  });
}

// LocalStack queue URLs point at *.localhost.localstack.cloud (loopback inside a container),
// so the SQS client must keep the configured endpoint instead of the queue URL host.
export function createSqsClient(): SQSClient {
  return new SQSClient({
    useQueueUrlAsEndpoint: false,
    requestHandler: { requestTimeout: SQS_REQUEST_TIMEOUT_MS, throwOnRequestTimeout: true },
  });
}
