import type { Config } from '../../config';
import { MockProvider } from './mock';
import type { PaymentProvider } from './types';

export function createPaymentProvider(config: Config): PaymentProvider {
  switch (config.PAYMENT_PROVIDER) {
    case 'mock':
      return new MockProvider({ failureRate: config.MOCK_FAILURE_RATE });
  }
}
