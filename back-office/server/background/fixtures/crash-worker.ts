import { backgroundQueue } from '../queue.ts';
import { backgroundRuntime } from '../runtime.ts';

const queue = backgroundQueue(process.env.BACK_OFFICE_TEST_BROKER_URL!);
await backgroundRuntime(
  process.env.BACK_OFFICE_TEST_BROKER_URL!,
  async (task) => {
    process.send?.(task);
    await new Promise(() => {}); // Parent commits actual ledger delivery, then kills this process before acknowledgement.
  },
  queue,
  { name: 'crash-fixture', concurrency: 1, lockDuration: 1000, stalledInterval: 500 },
);
process.send?.('ready');
