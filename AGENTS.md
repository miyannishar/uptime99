# uptime99 — Data Model Guide

This document is for anyone about to edit the data files that drive uptime99. Read it before touching anything under `data/`. Its job is to make the cost of a wrong edit visible before you make it.

---

## 1. What this repo is

uptime99 is an infrastructure strategy game. Players build a system from components (nodes), run that system through incidents, and pay real budget to keep it healthy. The game loop is: **incident fires → player picks an action on an affected node → the action resolves (or fails) → time, money, and metric costs are applied**. The board the player sees is assembled from the files in `data/` every time a save is loaded. Incidents do not rewrite the board; they change per-save instance state that sits on top of the board.

---

## 2. The two-layer rule — the most important thing in this file

Every file under `data/` is a **global definition**. It is identical for every player, for every save, for all time. It is loaded once and never mutated at runtime.

The other half of the model is per-save **instance state**: the health of each node, the tags incidents have applied, the current tier, which actions are on cooldown. Instance state is shaped by `data/schema/state.schema.json` and lives entirely outside `data/`.

**What breaks when you violate this:**
Adding a field like `health`, `tier` (current), `tags_runtime`, or `utilization_pct` to any file under `data/nodes/` feels harmless — you are just storing more data. But two players' saves share the same definition object at load time. Mutating it at runtime changes the board for every game simultaneously, in ways that persist across saves, corrupt replays, and cannot be undone. The schemas under `data/schema/` use `"additionalProperties": false` precisely to reject fields that do not belong in a definition, so this error is caught at validation time — but only if you run the validator.

**The rule in one sentence: definitions are never mutated at runtime.**

If you need a field that varies per save, it belongs in instance state, not in `data/`.

---

## 3. File map

| Path | What lives there |
|---|---|
| `data/schema/` | Six JSON schemas — one per data file type plus `state.schema.json`. All use `"additionalProperties": false` and JSON Schema 2020-12. A field not in the schema is an error, not a warning. |
| `data/tags.json` | 49 tags in four kinds: 19 weakness, 16 capability, 9 property, 5 posture. Tags are the closed vocabulary for describing a node's current state and for gating actions. |
| `data/layers.json` | 7 architectural layers. Four (edge → ingress → compute → data) are on the request path with `layer_index` 1–4. Three (reliability, observability, delivery) are off-path with `layer_index: null`. |
| `data/nodes/` | 7 files, one per layer, holding 26 nodes and 80 tiers total. Each file is a JSON **object** with a single top-level `nodes` array — `{ "nodes": [ ... ] }`. Nothing is keyed by layer name; a node states its own layer in its `layer` field, and the filename is a convention only. |
| `data/actions.json` | 33 actions. Each action carries a `constraint` predicate that determines which nodes and tiers it appears on. Actions are NOT stored per-node. |
| `data/metrics.json` | 7 metrics (4 technical, 3 business) plus an `economy` block holding the global pricing and balance coefficients. Technical: `uptime_pct`, `p95_latency_ms`, `error_rate_pct`, `reputation`. Business: `users`, `cost_month`, `profit_month`. |

---

## 4. How to verify a change

Run both commands. Both must pass before the change is considered valid.

```
npm test
npm run validate
```

`npm test` runs the full vitest suite. `npm run validate` runs `src/validate/integrity.ts` against every data file. **`npm run validate` is the authoritative definition of valid data** — it checks things the JSON schemas alone cannot, such as whether `cost_month` strictly increases across tiers and whether every tier has at least one playable action. A schema-valid file can still fail `npm run validate`.

Expected final output from `npm run validate`: `✓ all data files valid`

---

## 5. How to add a node

1. **Pick the right layer file** in `data/nodes/`. A node belongs to exactly one layer. Layer membership is fixed by the spec; do not invent new layers. Append your node to that file's top-level `nodes` array.

2. **Declare all 11 required node-level fields.** Every one is required by `data/schema/node.schema.json`; omitting any fails validation:
   - `id` — `snake_case`, unique across all 7 files
   - `name` — display name
   - `layer` — one of the 7 layer ids in `data/layers.json`
   - `role` — the node's functional role id (e.g. `relational_store`)
   - `description` — what the component does and how it fails
   - `singleton` — boolean; if `true`, `max_instances` must be 1
   - `max_instances` — how many of this node a board may hold
   - `provides` — capability ids this node offers to others
   - `requires` — ports this node needs, each `{ port, accepts, min, max }`
   - `overridable_edges` — boolean; whether the player may rewire its edges
   - `tiers` — the tier array (see below)

3. **Update the node count in two places.** `src/validate/integrity.ts` hardcodes `if (c.nodes.length !== 26)` (check 3) and `tests/integrity.test.ts` asserts 26 twice (`loads 26 nodes`, `has unique node ids across every file`). A 27th node fails `npm run validate` and `npm test` until all three are updated. The same applies to tags: adding one to `data/tags.json` requires updating the count assertion in `tests/tags.test.ts` (currently 49).

4. **Give the node 3–4 tiers.** Tiers must be numbered contiguously from 1. A node with fewer than 3 tiers gives the player no meaningful upgrade path; more than 4 tiers outpaces the budget curve.

5. **Declare all seven universal stats on every tier.** Missing even one fails the schema:
   - `capacity` — numeric throughput ceiling
   - `capacity_unit` — must be one of the enum values: `qps`, `rps`, `connections`, `msgs_sec`, `events_sec`, `lookups_sec`, `builds_day`, `gb`, `none`
   - `base_latency_ms` — baseline processing time at this tier
   - `availability_pct` — the fraction of time this tier is up under normal conditions
   - `cost_month` — monthly cost in game currency
   - `provision_time_s` — how long an upgrade or provision takes
   - `blast_radius` — fraction of overall uptime lost if this node goes down (0.0–1.0 inclusive)

6. **Add domain stats if the node type warrants them.** Domain stats are optional per-tier fields that capture characteristics specific to a node's role — `replicas`, `max_connections`, `iops`, `hit_ratio_pct`, `rpo_minutes`, and 31 others. The `stats` object uses `"additionalProperties": false`, so inventing a name outside the approved 36 fails schema validation. The authoritative list is in `data/schema/node.schema.json` under `properties.nodes.items.properties.tiers.items.properties.stats.properties`. Do not paste an invented name and assume it will be ignored; it will fail.

7. **Add `cost_variable` if the node has real usage-based pricing.** This optional tier field carries per-use rates such as `per_gb_transfer`, `per_million_requests`, `per_gb_ingested`, `per_build_minute`, and three others — all keys are a closed list in the schema. 28 tiers across 11 nodes currently use it (object_store, cdn, ci_cd, and others). If the node you are adding charges by the request or by the gigabyte, author the rates here rather than inflating `cost_month`.

8. **`cost_month` must strictly increase across tiers.** Equal values fail `npm run validate`. The integrity check is `t.stats.cost_month <= previousTier.stats.cost_month → error`.

9. **Use only tag ids that already exist in `data/tags.json`.** Do not invent tag ids inline. The `tags` field in `data/schema/node.schema.json` accepts any string, so the schema alone will not catch a bad id — the integrity script does (`src/validate/integrity.ts` lines 247-250), and a typo there means the action gating that tag silently never fires. See §6 for how to add a new tag first.

10. **Do not include runtime-only tags in any tier definition.** See §7.

11. **Confirm at least one action other than `upgrade_tier` matches every tier.** This is the most common mistake new nodes make. The integrity script (`src/validate/integrity.ts`, line 256) checks this explicitly: a tier that only matches `upgrade_tier` produces the error "no action beyond upgrade_tier matches, so the player cannot act on it during an incident." A node the player can see but never act on is a dead end in the incident loop. Work through the predicates in `data/actions.json` for each tier before committing.

12. **If a tier genuinely needs an action unavailable elsewhere,** add it to `data/actions.json` first (see §8), then reference it in `actions_extra` on that tier. Use `actions_deny` to suppress global actions that would be nonsensical on this tier.

13. **Deny `upgrade_tier` on the node's highest tier.** Every node's top tier carries `"actions_deny": ["upgrade_tier"]`, because `upgrade_tier` has an empty constraint and would otherwise be offered where it cannot execute — `tier` is capped at 4 by `data/schema/state.schema.json`. This is the one systematic, non-exceptional use of `actions_deny`; all 26 top tiers have it and no other tier does.

---

## 6. How to add a tag

Always add the tag to `data/tags.json` **before** referencing it anywhere else. The node schema accepts any string in the `tags` array — it does NOT validate tag ids. The integrity script does (`src/validate/integrity.ts` lines 247-250), and it will produce a clear "unknown tag" error when you run `npm run validate`. Still, a tag that does not exist yet cannot be referenced correctly, and the integrity check is the only net beneath you.

A tag entry requires:
- `id` — `snake_case`, unique across all tags
- `kind` — one of `weakness`, `capability`, `property`, `posture`
- `description` — one plain-language sentence explaining what this tag means on a node that has it
- `targeted_by` — list of incident ids that exploit or trigger on this tag (may be empty)
- `resolved_by` — list of action ids that remove or fix this tag

**Weakness tags must name at least one resolving action in `resolved_by`.** This invariant is enforced by `npm test` — specifically `tests/tags.test.ts` ("gives every weakness tag at least one resolving action"). A weakness that nothing can resolve is one the player can never fix; if the action that resolves it does not yet exist, add the action first (§8). Separately, the integrity script (check 6, `src/validate/integrity.ts` line 263) validates that every action id in `resolved_by` actually exists in `data/actions.json` — this runs under `npm run validate`.

This split recurs throughout the model: some invariants are enforced by `npm test` and others by `npm run validate`. Running only one is not enough, which is why §4 requires both.

Capability and property tags describe the node's stable characteristics rather than a problem, so empty `resolved_by` is normal for them.

Never add a tag inline in a node file or anywhere other than `data/tags.json`. There is no inline tag syntax — a tag id must be registered in `data/tags.json` before use, and the integrity script (`src/validate/integrity.ts` lines 247-250) is what enforces it.

---

## 7. Runtime-only tags — do not put these in definitions

Two tags in `data/tags.json` carry `"runtime_only": true`:

- **`cold_cache`** — applied by incidents such as `cache_eviction_storm` and `redis_restart`. Removed by the `warm_cache` action.
- **`unbounded_queue`** — applied by incidents such as `consumer_lag_spike` and `queue_overflow`. Removed by the `drain_queue` action.

These tags describe a transient incident condition, not a structural property of the node. They must **never appear in a tier definition** in any file under `data/nodes/`. If you place `cold_cache` on a tier, you are telling every player's game that this node is permanently in a cache-cold state, which is not meaningful and will cause confusing action availability. The integrity script rejects any tier definition that references a runtime-only tag (line 249).

The fact that `warm_cache` removes `cold_cache` and `flush_cache` adds it is not an inconsistency — those actions exist specifically to create and resolve this transient condition at runtime.

---

## 8. How to add an action

Add one entry to `data/actions.json`. Do not add per-node action lists anywhere in `data/nodes/`.

An action applies to a tier when its `constraint` predicate matches that tier's context. Predicates are objects with optional keys (all ten defined in `src/validate/matchActions.ts`):
- `layers` — action is available only on nodes in these layers
- `roles` — action is available only on nodes with these role ids
- `node_ids` — action is available only on these specific node ids
- `tags_all` — tier must carry all of these tags
- `tags_any` — tier must carry at least one of these tags
- `tags_none` — tier must carry none of these tags
- `min_tier` — action is available only at this tier number or higher (e.g. a "high-tier emergency drain" that only appears at tier 3+)
- `max_tier` — action is available only at this tier number or lower
- `min_health` — action is available only when health is at or above this threshold
- `max_health` — action is available only when health is at or below this threshold
- An empty `{}` constraint matches every tier (used by `upgrade_tier`)

`min_tier`/`max_tier` are the natural way to write an action that only becomes available at a higher tier. Use them before reaching for `actions_deny` on individual tiers.

The `constraint` is the right place to control availability. Prefer broad predicates over narrow ones: an action that applies to all `data`-layer stateful nodes is better than one wired to three specific node ids.

**`actions_extra` and `actions_deny` on a tier** are escape valves for genuinely unique situations — a node-level debug command that has no analogue elsewhere, or a global action that would be destructive on this specific tier. Do not use them as a substitute for writing a well-scoped predicate in `data/actions.json`. Every use of `actions_extra`/`actions_deny` is a maintenance burden that will not be obvious six months from now.

`npm run validate` checks the whole action registry, not just its shape. Beyond the JSON schema, `src/validate/integrity.ts` enforces:

- **check 7** (`checkActionMetricKeys`) — metric keys in `on_success.metrics`/`on_fail.metrics` are real metric ids.
- **check 8** (`checkActionTagRefs`) — every tag id in `constraint.tags_all`, `constraint.tags_any`, `constraint.tags_none`, `on_success.tags_add`, `on_success.tags_remove` and `on_fail.tags_add` exists in `data/tags.json`.
- **check 9** (`checkActionNodeAndRoleRefs`) — every `constraint.node_ids` entry is a real node id and every `constraint.roles` entry a real node `role`.
- **check 10** (`checkActionStatsDelta`) — every key of `on_success.stats_delta` is declared in `stats` on *every* tier the action can match. A percentage delta applied to a stat the tier does not declare yields `NaN` or a silent no-op after the player has already spent incident time, so this fails validation rather than shipping.
- **check 11** (`checkActionReachability`) — every action matches at least one tier. An action nothing matches is dead content.

Checks 10 and 11 both resolve matches through `matchableTiers`, which drops `min_health`/`max_health` and treats runtime-only tags as satisfiable. That is why `restart` (`max_health: 60`) and `warm_cache` (requires the runtime-only `cold_cache`) count as reachable: they are playable mid-incident, just not at health 100 with definition tags alone. Nothing is special-cased by action id.

One trap the schema now closes for you: `tags_all`, `tags_any` and `tags_none` each carry `"minItems": 1`. An empty array is truthy in JavaScript, so `"tags_any": []` reads to the matcher as a real constraint that no tier can satisfy — the action would be silently unreachable forever. Authoring it is an error, not a no-op.

---

## 9. Cost rules — how incidents price themselves

Incidents do not compute cost. An incident emits a **priced event** — a `kind` (e.g. `sla_credit`, `incident_remediation`) and a `basis` (a multiplier or flat amount) — and the cost engine prices it using the coefficients in `data/metrics.json`'s `economy` block.

The `economy` block is the single source of pricing constants:

```
arpu                         — revenue per user per tick
starting_budget              — credits the player begins with
credit_rate                  — SLA credit payout per breach unit
emergency_premium_multiplier — cost multiplier for emergency actions
reputation_decay_per_tick    — how fast reputation falls during an incident
reputation_recovery_per_tick — how fast reputation recovers after
tick_seconds                 — real-time seconds per game tick
reputation_growth_rate       — maximum monthly user growth at reputation 100
latency_churn_rate           — fractional user loss per 100 ms of p95 above the healthy range
outage_churn_rate            — fractional user loss per percentage point of uptime below the healthy range
saturation_knee              — utilisation fraction at which saturation_curve begins to bite
saturation_exponent          — steepness of saturation_curve past the knee
ledger_event_kinds           — closed enum of valid event kinds
```

**Never hardcode a price inside an incident definition.** If you need a new kind of charge, add a new `ledger_event_kind` constant and a coefficient to `economy`, then emit that kind from the incident. This keeps all pricing in one place, auditable and changeable without touching incident logic.

**The cost of moving a metric is derived, not authored.** The cost of improving uptime from 99.9% to 99.99% is whatever it costs to provision the tier combination that achieves that `availability_pct`, as reported by the nodes' `cost_month` stats. Do not write a number in any data file to represent "the price of this metric level." If you do, it will immediately drift from the actual tier prices the next time a node changes.

---

## 10. Metrics, formulas, and the request path

The `formula` strings in `data/metrics.json` are authored data, not code. They name node stats, other metrics, and `economy` constants; the engine evaluates them. Two things about them are easy to get wrong.

### What `path` means — the one and only rule

The `p95_latency_ms` formula is `sum(path.base_latency_ms * saturation_curve(path.util))`. `path` is the set of nodes on the **synchronous request path**, defined as:

> A node is on the synchronous request path **if and only if** its layer has `on_request_path: true` in `data/layers.json`, **and** the tier does not carry the `async` or `scheduled` property tag.

Four layers are on-path: `edge`, `ingress`, `compute`, `data`. The three off-path layers (`reliability`, `observability`, `delivery`) have `layer_index: null` and are never in the sum.

**`data/layers.json` is the single source of truth for this. There is no per-node tag for it and there must not be one.** An `on_request_path` tag used to exist in `data/tags.json` and was applied to only 7 of the 38 on-path tiers. Anyone filtering on the tag computed latency from the app tier alone and under-reported p95 by well over half (at tier 1 across the full path, 165 ms of 398 ms — a 58% under-report), silently — while anyone filtering on the layer boolean got a different answer. The tag was deleted precisely because two sources of truth for one fact is the bug. Do not reintroduce it: layer membership plus the `async`/`scheduled` exclusion already answers the question completely.

The same `path` set drives `error_rate_pct` (`clamp(max(path.util - 1) * 40, 0, 100)`).

### `message_queue`'s latency is not dead data

`message_queue` sits on the `data` layer (on-path) but carries `async`, so the rule above excludes it from the p95 sum. Its `base_latency_ms` of 5/4/3 is nonetheless real: it is **enqueue** latency, meaningful to a future asynchronous-lag mechanic, and must not be zeroed out as "unused." The same reasoning applies to any on-path-layer node carrying `async` or `scheduled` (`worker_pool` and `cron_scheduler` carry them with `base_latency_ms: 0`).

---

## 11. Where balance lives

There are exactly three places balance numbers exist:

1. **Node tier stats** (`data/nodes/*.json`) — `capacity`, `availability_pct`, `base_latency_ms`, `blast_radius`, `cost_month`, `provision_time_s`. These determine what each tier does and what it costs.

2. **Action costs** (`data/actions.json`) — `money_cost`, `time_cost_s`, `cooldown_s`, `difficulty`. These determine how expensive and risky each intervention is.

3. **Economy coefficients** (`data/metrics.json` → `economy`) — `arpu`, `credit_rate`, `emergency_premium_multiplier`, `reputation_decay_per_tick`, `reputation_recovery_per_tick`, `reputation_growth_rate`, `latency_churn_rate`, `outage_churn_rate`, `saturation_knee`, `saturation_exponent`. These determine how game-state events translate into money, reputation, and user growth or churn.

**Rates are constants; the formula terms are not.** The `users` formula reads `max(users * (1 + reputation_growth - latency_churn - outage_churn), 0)`. `reputation_growth`, `latency_churn` and `outage_churn` are **derived each tick** from the rate constants above and the current metric values — for example `latency_churn` comes from `latency_churn_rate` scaled by how far `p95_latency_ms` sits above its healthy range. Do not go looking for a `latency_churn` constant in `economy`; the constant is `latency_churn_rate`. The same holds for `saturation_curve`, which is not a constant but a function shaped by `saturation_knee` and `saturation_exponent`.

Balance does not live anywhere else. In particular:
- Not in incident definitions (they emit events, not prices)
- Not in schema files (schemas are contracts, not defaults)
- Not in per-save state (that is the outcome of balance, not its source)

When a balance change is requested, the answer is always "change one of these three places and run `npm test && npm run validate`."

---

## 12. Spec

The full design spec, including the rationale for the layer taxonomy, the incident loop, the tier model, and the economics design, is at:

`docs/superpowers/specs/2026-09-17-node-taxonomy-data-model-design.md`

Read it before making structural changes — changes that add or remove layers, redefine what a tier means, or alter the metric formulas. The spec is the source of truth for intent; this document is the source of truth for how to edit the data safely.
