// Scheduling from agent initialization. The persona's audit frequency (minutes)
// becomes the recurring job's interval; the accelerated 48-hour simulation mode
// (AETHRA_SIM_ACCELERATION) compresses it for automated tests without changing
// production behavior.

import { getJobQueue } from './index';

/** Parse a persona frequency (minutes string like "15" / "30" / "60") into ms. */
export function frequencyToMs(frequency: string | undefined): number {
  const minutes = Number(frequency ?? '30');
  const clamped = Number.isFinite(minutes) && minutes >= 1 ? Math.floor(minutes) : 30;
  return clamped * 60_000;
}

/** Schedule (or refresh) the agent's recurring durable job. Idempotent. */
export function scheduleAgentJob(agentId: string, frequency?: string): string {
  return getJobQueue().scheduleAgent(agentId, frequencyToMs(frequency));
}
