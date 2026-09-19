import { and, desc, eq } from 'drizzle-orm'
import type { Simulation } from '../core/index.js'
import { simulationSchema } from '../core/index.js'
import { simulations } from '../db/schema.js'
import type { PlanDb } from './store.js'

/**
 * The simulation log.
 *
 * A plan carries its latest simulation as evidence, and this table keeps
 * every run: the plan is append-only, and a prediction that was shown to
 * somebody and later re-run should leave both answers behind. #24 re-simulates
 * on open and before submit, so a plan will have several.
 *
 * The row stores the parsed simulation whole rather than spreading it across
 * columns. The plan doc requires chain, block, simulator identity, result
 * hash and timestamp to be recorded, and they are already exactly the fields
 * of `Simulation` — a second copy in columns would be two things to keep
 * honest instead of one.
 */

export interface RecordSimulationInput {
  planId: string
  planVersion: number
  simulation: Simulation
  /** The provider's own body, for an audit nobody hopes to need. */
  raw?: unknown
}

export async function recordSimulation(
  db: PlanDb,
  { planId, planVersion, simulation, raw = null }: RecordSimulationInput,
): Promise<void> {
  await db.insert(simulations).values({
    planId,
    planVersion,
    provider: simulation.provider,
    ok: simulation.success,
    assetDiff: simulation.assetChanges,
    raw: { simulation, provider: raw },
  })
}

/** The most recent run for a version, or null. What a re-open reads before re-simulating. */
export async function latestSimulation(
  db: PlanDb,
  planId: string,
  planVersion: number,
): Promise<Simulation | null> {
  const [row] = await db
    .select({ raw: simulations.raw })
    .from(simulations)
    .where(and(eq(simulations.planId, planId), eq(simulations.planVersion, planVersion)))
    .orderBy(desc(simulations.createdAt))
    .limit(1)
  const stored = (row?.raw as { simulation?: unknown } | null)?.simulation
  if (!stored) return null
  const parsed = simulationSchema.safeParse(stored)
  return parsed.success ? parsed.data : null
}
