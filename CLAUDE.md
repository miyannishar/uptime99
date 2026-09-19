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
| `data/schema/` | Ten JSON schemas — one per data file type plus `state.schema.json`. All use `"additionalProperties": false` and JSON Schema 2020-12. A field not in the schema is an error, not a warning. |
| `data/tags.json` | 47 tags in four kinds: 19 weakness, 16 capability, 9 property, 3 posture. Tags are the closed vocabulary for describing a node's current state and for gating actions. |
| `data/incidents/` | 49 incidents across 7 family files. Each file is a JSON object with a top-level `incidents` array. The 7 families and their counts are hardcoded in `src/validate/incidentChecks.ts` and asserted in `tests/incidentIntegrity.test.ts`. |
| `data/layers.json` | 7 architectural layers. Four (edge → ingress → compute → data) are on the request path with `layer_index` 1–4. Three (reliability, observability, delivery) are off-path with `layer_index: null`. |
| `data/nodes/` | 7 files, one per layer, holding 26 nodes and 80 tiers total. Each file is a JSON **object** with a single top-level `nodes` array — `{ "nodes": [ ... ] }`. Nothing is keyed by layer name; a node states its own layer in its `layer` field, and the filename is a convention only. |
| `data/actions.json` | 33 actions. Each action carries a `constraint` predicate that determines which nodes and tiers it appears on. Actions are NOT stored per-node. |
| `data/metrics.json` | 7 metrics (4 technical, 3 business) plus an `economy` block holding the global pricing and balance coefficients. Technical: `uptime_pct`, `p95_latency_ms`, `error_rate_pct`, `reputation`. Business: `users`, `cost_month`, `profit_month`. |
| `data/minigames/formats.json` | 5 interaction format definitions. Each format declares the levers it supports, with a type and `min`/`max`/`values` for each — though only lever **names** are enforced anywhere, not their values. It does **not** declare `wrong_outcomes[].when` legality; that map lives in `tests/helpers/dataFiles.ts`. |
| `data/minigames/registry.json` | 15 minigame entries, each carrying exactly four fields: `id`, `name`, `format`, `description`. A minigame does **not** declare its own difficulty — difficulty comes from the action that invokes it, which is why the difficulty-slot rule in §14 is enforced across files rather than inside this one. |
| `data/minigames/instances/` | 5 instance files (`a-sequence.json` through `e-evidence.json`), one per format. 29 instances total across 24 difficulty-slots. Each instance carries both format-agnostic fields (`brief`, `teaches`, `wrong_outcomes`, `reveal`) and format-specific fields (`given`, `solution`, optional `distractors`, `levers`). |

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

3. **Update the node count in two places.** `src/validate/integrity.ts` hardcodes `if (c.nodes.length !== 26)` (check 3) and `tests/integrity.test.ts` asserts 26 twice (`loads 26 nodes`, `has unique node ids across every file`). A 27th node fails `npm run validate` and `npm test` until all three are updated. The same applies to tags: adding one to `data/tags.json` requires updating the count assertion in `tests/tags.test.ts` (currently 47).

4. **Give the node 3–4 tiers.** Tiers must be numbered contiguously from 1. A node with fewer than 3 tiers gives the player no meaningful upgrade path; more than 4 tiers outpaces the budget curve.

5. **Declare all seven universal stats on every tier.** Missing even one fails the schema:
   - `capacity` — numeric throughput ceiling
   - `capacity_unit` — must be one of the enum values: `qps`, `rps`, `connections`, `msgs_sec`, `events_sec`, `lookups_sec`, `builds_day`, `gb`, `none`
   - `base_latency_ms` — baseline processing time at this tier
   - `availability_pct` — the fraction of time this tier is up under normal conditions
   - `cost_month` — monthly cost in game currency
   - `provision_time_s` — how long an upgrade or provision takes
   - `blast_radius` — fraction of overall uptime lost if this node goes down (0.0–1.0 inclusive)

6. **Add domain stats if the node type warrants them.** Domain stats are optional per-tier fields that capture characteristics specific to a node's role — `replicas`, `max_connections`, `iops`, `hit_ratio_pct`, `rpo_minutes`, and 38 others. The `stats` object uses `"additionalProperties": false`, so inventing a name outside the approved 43 fails schema validation. The authoritative list is in `data/schema/node.schema.json` under `properties.nodes.items.properties.tiers.items.properties.stats.properties`. Do not paste an invented name and assume it will be ignored; it will fail.

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

- **`cold_cache`** — produced by incidents via `damage.tags_add`: `cache_eviction_storm`, `redis_restart`, and `process_restart`. Removed by the `warm_cache` action.
- **`unbounded_queue`** — produced by incidents via `damage.tags_add`: `consumer_crash` and `scheduler_drift`. Removed by the `drain_queue` action.

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

**Every action requires a `minigame` and a `difficulty`** (both are required by `data/schema/action.schema.json`). That couples this file to the minigame layer: a new `minigame:difficulty` pair that no existing instance covers creates a 25th difficulty-slot, and `checkSlotCoverage` will fail `npm run validate` until you author an instance for it. Prefer an existing pair unless the action genuinely needs a new one — and if it does, author the instance in the same change. See §14.

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

---

## 13. Incidents

The full incident-system design spec is at `docs/superpowers/specs/2026-09-17-incident-system-design.md`. This section is a working guide; the spec is the source of truth for design rationale.

### What an incident is

An incident targets a weakness, damages instance state, and the metrics fall out of that. This ordering matters: the incident authors a `damage` block (health delta, tag additions), and the metric formulas derive consequences from the resulting instance state. The incident never computes a metric value directly, and it never contains a currency amount — cost is the engine's job.

Three narrow rules follow from this:

1. **Never name a fix mechanism beyond `resolved_by`.** An incident declares which actions can resolve it. How those actions succeed or fail is the action's own definition and the engine's execution. An incident that describes a "recommended fix" in prose is fine; one that encodes pricing or success probability for a fix mechanism is not.

2. **Never include a currency amount.** Incidents emit a `ledger_event` with a `kind` (e.g. `sla_credit`, `incident_remediation`) and a `basis` multiplier. The cost engine prices that event using the coefficients in `data/metrics.json`'s `economy` block. If a new kind of charge is needed, add a `ledger_event_kind` constant and an economy coefficient; do not write a number into the incident definition, because it will immediately drift from the tier prices the next time a node changes.

3. **Never write a metric except reputation via `severity`.** Incidents influence metrics indirectly, through instance state. The one exception is `reputation`: each active incident contributes its `severity` to `incident_severity`, and `incident_severity` enters the `reputation` formula. That is the incident's only direct hook into the metric layer.

### The three scopes

**`instance`** — fires on one node tier that matches `target`. `target` is a constraint predicate (same vocabulary as action constraints: `layers`, `roles`, `node_ids`, `tags_all`, `tags_any`, `tags_none`, `min_tier`, `max_tier`). Damage is applied to that instance.

**`group`** — fires on every node tier matching `target`, filtered by `group_by` (`region`, `layer`, or `def_id`). All matching instances in the selected group are damaged in the same tick. Use this when a failure mode plausibly strikes a whole zone or layer at once.

**`architecture`** — does not target a node at all (`target: null`). Fires when the `fires_when` posture condition holds (e.g. no node carries the `encrypted_at_rest` capability, or no backup node exists). Architecture-scope incidents describe a *gap in the system design*, not a failure of one component. Because no node is targeted, `damage.health_delta: -5` is required by the schema but is applied to nothing — the field exists only to satisfy the schema's requirement that `damage` be non-empty. Two incidents had to be corrected when they gave this field meaningful values, expecting it to deal real damage to something.

### `incident_severity` and `down`

`incident_severity` is not a stored field anywhere. The `reputation` formula computes it as the **sum of `severity` across all active incidents in the current tick**. Do not look for it in instance state. Do not write it into any data file.

`down` is a separate boolean in instance state (`state.schema.json` requires it). `down: true` means the node is unreachable — the engine cannot route traffic to it at all. `health: 0` means the node is up but failing under load: it accepts traffic and returns errors. `uptime_pct` reads `node.down`, not `node.health`. A node at health 0 is failing but still counts toward uptime; a `down` node does not.

### Signal levels

Incidents carry a `signals` array, each entry with a `level` (0–3) and optional `requires` (a constraint the player's observability setup must satisfy to see it).

| Level | What the player sees | Who can see it |
|---|---|---|
| 0 | Something is wrong — a metric is off, SLA alerts are firing | Always visible — no observability required |
| 1 | The affected layer or region is named | Requires basic tracing |
| 2 | The specific instance is named | Requires distributed tracing |
| 3 | The root cause is named | Requires structured logging plus tracing |

**Level 0 must never leak diagnostic information.** If it names a layer, a component, or a root cause, the observability layer stops mattering — a player who has invested nothing in monitoring gets the same signal as one who has. The level-0 signal is what an on-call engineer sees on their phone at 2 a.m. before opening a single dashboard: "p95 is elevated" or "error rate is climbing." No more. Tracing is what you have at level 1 and above.

Architecture-scope incidents cannot name a specific instance at levels 2–3, because no instance is involved. Their level-2 and level-3 signals describe the scope of the gap: "seven of your nine data-layer nodes are unencrypted", not "postgres-primary has a problem."

### How to add an incident

1. **Pick a family file** in `data/incidents/`. The seven families are `infrastructure`, `capacity`, `data`, `queue`, `security`, `delivery`, and `business`. Each has a hardcoded count in `src/validate/incidentChecks.ts` (`checkIncidentCount`) and in `tests/incidentIntegrity.test.ts`. Adding a 50th incident means updating both: the `EXPECTED_FAMILIES` record in `incidentChecks.ts` and the test assertion. There is no exception.

2. **Use only existing tags and constraint fields.** Do not invent tag ids inline. Do not use constraint keys outside the ten defined in `src/validate/matchActions.ts`. Both are caught by `checkIncidentConstraintRefs` at validate time, but a typo in a tag id means the incident fires on the wrong nodes silently until validation runs.

3. **Give it a level-0 signal that reveals nothing diagnostic.** See the signal table above. Write the level-0 text last — it is the hardest signal to write correctly, because the instinct is to be helpful.

4. **Ensure `resolved_by` actions are matchable.** Every action in `resolved_by` must actually be offered on at least one node tier the incident can target. `checkResolvedByMatchable` in `incidentChecks.ts` will catch a mismatch, but it runs at `npm run validate` time, not at authoring time. Test it early.

5. **For architecture scope, set `target: null` and write `fires_when`.** Give `damage.health_delta: -5` (schema requires a non-empty `damage`; this value is applied to nothing). The `fires_when` condition must reference tags that exist on real node tiers — an architecture incident whose `fires_when.no_node` requires a tag no tier carries can never fire.

6. **An empty `resolved_by` is legal — it means the incident can only be survived, not repaired.** A survive-only incident MUST carry a `duration_ticks`; without it, nothing would ever end the incident and validation fails. Five incidents use this pattern: `data_loss_incident` (40 ticks), `region_outage` (35), `provider_outage` (30), `disaster_recovery_drill` (25), and `vendor_outage` (20). The reason each is survive-only is also the reason you cannot solve it with a resolving action: you cannot repair someone else's cloud (`provider_outage`, `vendor_outage`), you cannot restore data you never backed up (`data_loss_incident`), you cannot regionalise out of a region that is already burning (`region_outage`), and a drill runs its course by design (`disaster_recovery_drill`). A companion invariant: a survive-only incident must never carry an `on_resolve` ledger event — it can never resolve, so the event would never fire. That defect shipped once during this cycle and had to be corrected.

7. **Do not fix a coverage gap by editing `data/nodes/`.** If `npm run validate` reports a weakness as unhunted (via `checkWeaknessCoverage`), the fix is to add that tag to an existing incident's `tags_none` or `tags_all` constraint, not to add the weakness tag to a node definition. The node catalog belongs to an earlier cycle with its own tests and review. During this cycle an agent added weakness tags to `app_cluster` and `worker_pool` to close a coverage gap, producing a tier that was simultaneously `canary_capable` and `no_rollback` — a contradiction — and duplicating information that the capability's absence already expressed. The node definitions were reverted. **Do not repeat this.**

### The runtime-tag production rule and `checkWeaknessCoverage`

`cold_cache` and `unbounded_queue` are `runtime_only` and never appear in a node definition; they are produced by incidents via `damage.tags_add`. `cold_cache` has three producers: `cache_eviction_storm`, `redis_restart`, and `process_restart`. `unbounded_queue` has two: `consumer_crash` and `scheduler_drift`.

Incidents that *target* those tags — that require `cold_cache` or `unbounded_queue` in their `target` constraint — are reachable only after one of their producers has fired. Getting this backwards (expecting a producer to also be a targeted incident, or requiring a runtime tag in a node definition) makes an incident unfireable. The original tag registry had the relationship inverted: it had `targeted_by` entries for producer incidents rather than consumer incidents. That was corrected during the incident cycle.

`checkWeaknessCoverage` contains a subtlety that has already caused one incorrect manual "fix." It treats a weakness as **hunted** if an incident either:

- references the weakness tag id directly in `tags_all`, `tags_any`, or `tags_none`, **or**
- references one of the weakness's *paired capabilities* in `tags_none`.

The paired capabilities for a weakness `W` are the union of `on_success.tags_add` across all actions in `W.resolved_by`. The logic is: if an action resolves weakness `W` and grants capability `C`, then an incident that looks for nodes *lacking* `C` (i.e., `tags_none: ["C"]`) is effectively targeting the same nodes that carry `W`. So `load_surge` hunting `tags_none: ["autoscaling"]` covers `no_autoscale` entirely, because `enable_autoscaling.on_success.tags_add` includes `autoscaling`.

If you run `npm run validate` and see a weakness reported as unhunted, check whether a paired capability is already in some incident's `tags_none` before adding any tag anywhere. The check message includes the hint: `(neither the tag nor its paired capabilities [...] appear in any incident constraint)`. If paired capabilities are listed in the hint, they genuinely are absent; if the hint is absent, the weakness has no paired capabilities and a direct tag reference is required.

### Which command enforces what

Both `npm test` and `npm run validate` are required — see §4. For the incident layer specifically:

`npm test` (via `tests/incidentIntegrity.test.ts`) enforces:
- Per-file schema validity for every incident file (via `expectValidIncidentFile`)
- That every `resolved_by` action id exists in `data/actions.json`
- That every tag id in `damage.tags_add` exists in `data/tags.json`

`npm run validate` (via `src/validate/incidentChecks.ts`) enforces six cross-file rules:

1. **`checkIncidentCount`** — exactly 49 incidents total, no duplicate ids, and each family has its expected count (infrastructure 10, capacity 8, data 8, queue 6, security 8, delivery 4, business 5).

2. **`checkTagIncidentBidirectional`** — every incident id in a tag's `targeted_by` names a real incident; and every non-architecture incident that targets non-runtime-only tags appears in at least one tag's `targeted_by`. The runtime-only tag exemption exists because incidents that target `cold_cache` or `unbounded_queue` are discovered transitively through their producers, not through the registry — requiring a `targeted_by` entry would invert the relationship.

3. **`checkIncidentConstraintRefs`** — all tag, layer, node, and role ids referenced in `target`, `fires_when`, `signals[n].requires`, and `damage.tags_add` exist in the catalog.

4. **`checkResolvedByMatchable`** — every action in `resolved_by` exists; for non-architecture incidents, the `target` constraint matches at least one real node tier; and each resolving action is actually offered on at least one of those targetable tiers. Architecture-scope incidents are exempt from the last two checks because they have no target.

5. **`checkEscalationGraph`** — every `escalates_to` target exists; every incident with `escalates_to` also has a non-null `escalate_after_ticks`; and no escalation chain forms a cycle.

6. **`checkWeaknessCoverage`** — every weakness tag is hunted by at least one incident, either directly or via a paired capability in `tags_none`. See the section above for the pairing rule.

`npm test` (via per-format test files and `expectValidInstanceFile`) also validates the minigame layer:
- Per-file schema validity for every instance file
- That every `wrong_outcomes[].when` value is legal for the instance's format

`npm run validate` (via `src/validate/minigameChecks.ts`) enforces five cross-file rules:

1. **`checkRegistryMatchesActions`** — every minigame id in the registry is referenced by at least one action in `data/actions.json`, and every minigame id referenced by an action exists in the registry.
2. **`checkFormatsResolve`** — every minigame in the registry names a format id that exists in `data/minigames/formats.json`.
3. **`checkSlotCoverage`** — every difficulty-slot (minigame id × difficulty level) reachable from `data/actions.json` has at least one instance. An action reaching an empty pool is a runtime failure, not a content gap.
4. **`checkInstanceRefs`** — every instance references a minigame id that exists in the registry, that minigame's format resolves, and every key of the instance's `levers` is a lever that format declares. It does **not** look inside `given` or `solution`, and it does not check lever values against their declared ranges.
5. **`checkInstanceIdsUnique`** — no two instances share an id across all five instance files.
6. **`checkInstanceShapes`** — every instance's `given` and `solution` carry the keys its format requires, with the right types. This is the only thing validating those two fields; see the schema-exception section below.
7. **`checkWhenLegality`** — every `wrong_outcomes[].when` is legal for the instance's format, and no instance mixes `any` with a specific value.

If a minigame data file is not schema-valid, checks 1–7 are **skipped** for that run. A file missing its top-level `instances` key would otherwise put `undefined` into the instance pool and throw a raw `TypeError`, hiding the schema error that was just reported. The exit code is non-zero either way.

---

## 14. Minigames

The full minigame design spec is at `docs/superpowers/specs/2026-09-18-minigame-data-model-design.md`. This section is a working guide; the spec is the source of truth for design rationale.

### What the minigame layer is

15 minigame ids are referenced by `data/actions.json`. They are skins over **5 shared interaction formats**, not 15 distinct mechanics. Research on comparable games found that mechanical variety saturates at 3–5 primitives — a single mechanic with only a difficulty dial (faster, more steps) hits fatigue quickly, while games that vary puzzle *structure* over a fixed primitive sustain much longer play. Fifteen distinct mechanics would impose a new learning curve every few encounters and buy no depth. The five formats cover the operations that matter: ordering, quantitative judgement, configuration, topology, and evidence interpretation.

### The five interaction formats

| Format id | What the player does | Why this format |
|---|---|---|
| `ordered_sequence` | Drag steps into the correct order | Order is operationally consequential: a DNS cutover, a restore, and a certificate chain each have one right sequence. Putting them out of order produces a real failure mode. |
| `fill_blank` | Fill in missing values in a config or manifest | YAML configs, cache keys, IAM policies, and incident comms are the actual artefacts engineers produce. The blank is where judgement lives. |
| `dial` | Move a slider to the correct quantitative threshold | Thresholds, replica counts, and instance sizes are continuous judgement calls with cost consequences in both directions. |
| `wiring` | Connect nodes to form a valid topology | Dependency and network topology errors are a class of problem that a form cannot represent; spatial arrangement is the right primitive. |
| `evidence` | Choose the correct root cause from a set of signals | Slow queries, bad deploys, and crash logs require reading evidence and ruling out distractors — interpretation, not configuration. |

### The difficulty-slot rule

Every instance carries a `difficulty` field. That difficulty must be a level at which some action in `data/actions.json` actually invokes the instance's minigame — otherwise the instance is content the engine can never select. `query_plan_puzzle`, for example, is only ever called at difficulty 3; an instance at difficulty 1 or 5 sits in an unreachable pool.

24 difficulty-slots exist across the 15 minigames. `checkSlotCoverage` (run under `npm run validate`) enforces that each slot has at least one instance. An action reaching an empty pool fails at runtime, not at authoring time — so validation is the only net.

Five slots carry two instances: `iam_policy_puzzle` 3, `query_plan_puzzle` 3, `queue_triage` 2, `restore_drill` 3, `threshold_tuning` 3.

### The format-agnostic / format-specific split

Every instance has two kinds of fields:

**Format-agnostic** — `brief`, `teaches`, `wrong_outcomes`, `reveal`. These are where the authoring value lives. They describe the scenario, what the player should learn, what goes wrong for each wrong answer, and the full explanation shown after failure. They survive a format being redesigned.

**Format-specific** — `given`, `solution`, optional `distractors`, `levers`. These are shaped by the interaction model and must be rewritten if the format changes.

This split exists because **no format has a shipped UI yet**. If the wiring interaction proves unworkable and `topology_puzzle` becomes a config-edit instead, only the format-specific fields are rewritten. The explanations — `teaches`, `wrong_outcomes`, `reveal` — survive intact. Mixing pedagogical content with interaction data would force a full rewrite of both.

### The `given`/`solution` schema exception

`given` and `solution` are the only fields in the project whose **entire contents** are unconstrained by schema. Both are typed as objects with `minProperties: 1` only. The reason: an instance names a minigame id, not a format id, and the schema cannot discriminate which shape to demand at validation time.

(Other fields relax `additionalProperties` for their *keys* while still constraining value shapes — `levers` here, `on_success.stats_delta` and the `metrics` maps in `action.schema.json`, `action_cooldowns` in `state.schema.json`. `given`/`solution` are different in kind: nothing whatsoever is checked.)

The compensating control is **`checkInstanceShapes`** in `src/validate/minigameChecks.ts`, run by `npm run validate`. It resolves each instance's format and asserts the required keys and their types:

| Format | `given` requires | `solution` requires |
|---|---|---|
| `ordered_sequence` | `steps` | `order` (array of integers) |
| `fill_blank` | `template` | `blanks` |
| `dial` | `table`, `unit`, `range` (numeric `min`/`max`) | `value` (number) |
| `wiring` | `nodes`, `zones`, `place` | `zone`, `connect_to` |
| `evidence` | `kind` (`log`/`explain`/`deploy_history`), `output` | `choice` |

**It requires presence and type; it does not reject extra keys.** Instances legitimately carry optional extras — `facts`, `options`, `language`, `context`, `edges` — and rejecting unknowns would fail valid data. Requiring the known keys is what catches a typo: `{"vlaue": 5}` leaves `value` missing, and the check names the instance and the field.

If you add a format, **add its row to `SHAPE_BY_FORMAT` in the same change**, or its instances get no payload validation at all.

This check was added after a review found the gap. Before it, `"solution": {"choise": "..."}` on an evidence instance passed the schema, every check, every test, and `npm run validate` — because the per-format test files were the only coverage and `tests/minigames.evidence.test.ts` never referenced `solution`. Per-format tests remain valuable for the *semantic* cross-checks a shape table cannot express (that `solution.value` falls inside `given.range`, that `connect_to` names nodes that exist), but they are no longer the only line of defence.

### The teaching loop

The player gets unlimited retries. On each failure, the engine matches the wrong answer against `wrong_outcomes` and shows the matching `shows` text alongside the metric consequence. The `on_fail` penalty applies per attempt. After the **third** failure the UI shows `solution` and `reveal` in full — the player still executes the action and still pays the time cost, but leaves knowing why.

**A cap on repeated-failure `on_fail` damage needs to be built into the engine** when the incident loop is implemented. A player on attempt four is the one most in need of teaching rather than punishing, and no floor exists yet. Record this as a required engine-side constraint; do not work around it in data by zeroing out `on_fail`.

### How to add an instance

1. **Pick the format file** (`data/minigames/instances/a-sequence.json` through `e-evidence.json`). The file name encodes the format.
2. **Use only levers that format declares** in `data/minigames/formats.json`. An undeclared lever key is a **hard failure in two places** — `checkInstanceRefs` under `npm run validate` and `expectValidInstanceFile` under `npm test`. Only the JSON schema ignores it. Note the converse is *not* enforced: nothing checks lever **values** against the `min`/`max`/`values` the format declares, so `"tolerance_pct": 95` passes both commands today. Stay inside the declared bounds by hand.
3. **Cover a slot that exists.** A minigame does **not** declare its own difficulty — there is no `difficulty_range` field anywhere. The legal difficulties for a minigame are exactly those at which some action in `data/actions.json` names it; §14's slot table is derived from that file and nothing else. `expectValidInstanceFile` rejects a difficulty no action demands, and `checkSlotCoverage` reports a demanded slot with no instance.
4. **Write a `teaches` that is transferable.** The `teaches` field should state a principle the player can apply elsewhere — "CPU requests are specified in 25m steps, rounded up from measured steady-state" — not a restatement of the answer — "the answer is 250m". The latter turns a judgement problem into transcription.
5. **Give every dial instance both a `below` and an `above` outcome.** A dial has two failure directions; both carry real lessons (under-provisioned fails, over-provisioned wastes money). An instance with only one is incomplete.
6. **Check `wrong_outcomes[].when` values against the format.** Legal values are: `any` (all formats) · `below`/`above` (`dial` only) · `wrong_order` (`ordered_sequence` only) · `wrong_value` (`fill_blank` only) · `wrong_target` (`wiring` only) · `wrong_choice` (`evidence` only). A `when` value from the wrong format will not fail schema validation — it will produce an outcome the engine never matches.
7. **Never mix `any` with a format-specific value** in the same instance's `wrong_outcomes`. An instance may use `any` alone, or one or more specific entries, but `any` mixed with a specific entry leaves the engine unable to determine which to show. Four of the five formats have only one legal specific value, so a single specific entry is the normal shape there; `dial` is the exception and needs both `below` and `above`.

   The legality of `when` per format is **not** declared in `formats.json` — it lives in `WHEN_BY_FORMAT`, exported from `src/validate/minigameChecks.ts` and imported by the test helper, and the schema's `when` enum is the flat union of all seven values across all formats. Editing `formats.json` will not change `when` legality. `checkWhenLegality` enforces it under `npm run validate`.

### Authoring standards

**`reveal` explains the mechanism, not the answer.** It is what the player reads after three failures. "A 250m request on a 500m node leaves headroom for bursts" is a mechanism; "The correct answer is 250m" is a label. The player already knows the correct answer at that point — they need to understand why.

**`wrong_outcomes[].shows` uses concrete numbers moving in the wrong direction.** "p95 climbs to 340 ms as the cache misses compound" is concrete; "performance degrades" is not. The player needs to see the consequence, not hear that one exists.

**A wrong answer that works but wastes money is a real lesson.** The cost model exists to express it. For a resource dial, over-provisioning is typically the `above` direction; for a scale-up threshold, the wasteful direction is `below`, where the autoscaler thrashes. Identify which direction represents waste for *this* instance and author that outcome explicitly.

**An instance is only a judgement test if the judgement is derivable from what the player is shown.** Every answer must follow from that instance's own `brief` and `given`. Two instances shipped violating this: one answered `250m` while its own facts said `235m`, and one required a 24-hour window with nothing on screen distinguishing 24 from 12 or 48. Both had to be fixed. Marking correct reasoning wrong is the worst failure available in a teaching tool.

**Supply the missing rule, not the missing answer.** When fixing an instance where the player cannot derive the answer, the fix is to add the rule to `given` ("CPU requests are specified in 25m steps, rounded up from measured steady-state") — not to embed the answer in the table. Adding the answer turns a judgement problem into transcription.

### Counts at a glance

| What | Count |
|---|---|
| Interaction formats | 5 |
| Minigames | 15 |
| Instances | 29 |
| Difficulty-slots | 24 |
| Difficulty levers across all formats | 14 |
