import { SNSClient } from '@aws-sdk/client-sns';
import { SQSClient } from '@aws-sdk/client-sqs';

import {
  createSnsClient,
  createSqsClient,
  SNS_REQUEST_TIMEOUT_MS,
  SQS_REQUEST_TIMEOUT_MS,
} from '@infrastructure/messaging/messaging-clients';

jest.mock('@aws-sdk/client-sns');
jest.mock('@aws-sdk/client-sqs');

describe('messaging clients', () => {
  it('should create the SNS client with a single attempt and a 2 s request timeout that throws', () => {
    createSnsClient();

    expect(SNSClient).toHaveBeenCalledWith({
      maxAttempts: 1,
      requestHandler: { requestTimeout: SNS_REQUEST_TIMEOUT_MS, throwOnRequestTimeout: true },
    });
    expect(SNS_REQUEST_TIMEOUT_MS).toBe(2_000);
  });

  it('should create the SQS client on the configured endpoint with a request timeout above the 20 s long poll', () => {
    createSqsClient();

    expect(SQSClient).toHaveBeenCalledWith({
      useQueueUrlAsEndpoint: false,
      requestHandler: { requestTimeout: SQS_REQUEST_TIMEOUT_MS, throwOnRequestTimeout: true },
    });
    expect(SQS_REQUEST_TIMEOUT_MS).toBe(25_000);
  });
});
