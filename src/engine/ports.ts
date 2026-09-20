import type { EngineCatalog } from './catalog'
import type { NodeInstance, PortFillView } from './types'

/** Instances whose definition `provides` at least one of `accepts`. */
function candidates(
  instances: readonly NodeInstance[], accepts: readonly string[],
  selfId: string, catalog: EngineCatalog,
): NodeInstance[] {
  const wanted = new Set(accepts)
  return instances.filter((i) => {
    if (i.instance_id === selfId) return false
    const def = catalog.nodeById.get(i.def_id)
    return !!def?.provides?.some((p: string) => wanted.has(p))
  })
}

/**
 * Fill every `requires` port on every instance, in instance order, and return
 * instances with `edges_out` set. Deterministic: candidates are taken in the
 * order they appear on the board, capped at each port's `max`.
 */
export function autoWire(
  instances: readonly NodeInstance[], catalog: EngineCatalog,
): NodeInstance[] {
  return instances.map((i) => {
    const def = catalog.nodeById.get(i.def_id)
    const ports: any[] = def?.requires ?? []
    const edges: string[] = []
    for (const port of ports) {
      for (const cand of candidates(instances, port.accepts, i.instance_id, catalog)) {
        // The count is taken from the shared `edges` accumulator, so it is only
        // correct while no consumer declares two ports with overlapping `accepts`.
        // If that ever changes, a port can report `filled.length > max` and show
        // unsatisfied while overfilled. The invariant is enforced by
        // `checkPortAcceptsDisjoint` in `src/validate/integrity.ts`.
        if (edges.filter((e) => matchesPort(e, port, instances, catalog)).length >= port.max) break
        if (!edges.includes(cand.instance_id)) edges.push(cand.instance_id)
      }
    }
    return { ...i, edges_out: edges }
  })
}

function matchesPort(
  instanceId: string, port: any,
  instances: readonly NodeInstance[], catalog: EngineCatalog,
): boolean {
  const target = instances.find((x) => x.instance_id === instanceId)
  if (!target) return false
  const def = catalog.nodeById.get(target.def_id)
  const wanted = new Set<string>(port.accepts)
  return !!def?.provides?.some((p: string) => wanted.has(p))
}

export function portFills(
  instances: readonly NodeInstance[], instanceId: string, catalog: EngineCatalog,
): PortFillView[] {
  const self = instances.find((i) => i.instance_id === instanceId)
  if (!self) return []
  const def = catalog.nodeById.get(self.def_id)
  const ports: any[] = def?.requires ?? []

  return ports.map((port) => {
    const filled = self.edges_out.filter((e) => matchesPort(e, port, instances, catalog))
    return {
      port: port.port,
      accepts: port.accepts,
      min: port.min,
      max: port.max,
      filled,
      satisfied: filled.length >= port.min && filled.length <= port.max,
    }
  })
}

export function unsatisfiedPorts(
  instances: readonly NodeInstance[], catalog: EngineCatalog,
): { instance_id: string; port: PortFillView }[] {
  return instances.flatMap((i) =>
    portFills(instances, i.instance_id, catalog)
      .filter((p) => !p.satisfied)
      .map((port) => ({ instance_id: i.instance_id, port })))
}
