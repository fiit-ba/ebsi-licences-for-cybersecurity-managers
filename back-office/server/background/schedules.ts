import { taskOptions, type backgroundQueue } from './queue.ts';
import type { BackgroundTask } from './types.ts';

/**
 * Configure periodic background tasks, refusing unusable intervals.
 * @param env - Existing deployment settings.
 * @returns Stable scheduler IDs, periods and maintenance operations.
 * @throws Error for nonpositive/nonfinite configured periods.
 */
export function backgroundSchedules(env = process.env) {
  const periods = [
    ['sweep-governance', Number(env.PLR_GOVERNANCE_RECONCILE_SECONDS ?? 120) * 1000],
    ['sweep-standing', Number(env.PLR_STANDING_SWEEP_SECONDS ?? 60) * 1000],
    ['purge-signing-intents', 3_600_000],
    ['purge-presentation-attributes', 300_000],
    ['sweep-timestamps', 600_000],
    ['revalidate-accreditation', 86_400_000],
  ] as const;
  return periods.map(([operation, every]) => {
    if (!Number.isSafeInteger(every) || every <= 0)
      throw new Error('Invalid background schedule period.');
    return { id: operation, every, task: { operation } as BackgroundTask };
  });
}

/**
 * Upsert stable BullMQ schedulers; restart/replica registration does not multiply schedules.
 * @param queue - Owned DB-0 queue client.
 * @param env - Environment overrides for periodic task intervals.
 * @returns Completion when all six schedules are registered.
 * @throws Broker/configuration errors; reconnect registration retries after Redis returns.
 */
export async function registerSchedules(
  queue: ReturnType<typeof backgroundQueue>,
  env = process.env,
) {
  for (const { id, every, task } of backgroundSchedules(env))
    await queue.upsertJobScheduler(
      id,
      { every, startDate: Date.now() + every },
      { name: task.operation, data: task, opts: taskOptions(task) },
    );
}
