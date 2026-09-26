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
| `data/schema/` | Twelve JSON schemas — one per data file type plus `state.schema.json`. All use `"additionalProperties": false` and JSON Schema 2020-12. A field not in the schema is an error, not a warning. |
| `data/stakeholders.json` | 6 timed stakeholder messages (CTO, support lead, investor, customer, finance). Each has a `trigger` (a metric crossing a value, or an active incident at or above a severity), 2–3 responses with `reputation_delta`/`budget_delta`, `expires_s` (real seconds) and `cooldown_ticks`. Schema `data/schema/stakeholder.schema.json`; `checkStakeholders` in `src/validate/stakeholderChecks.ts`. See §17. |
| `data/levels.json` | 5 level difficulty entries. Each holds the per-level difficulty curve: `arrival_mean_ticks` (how often incidents arrive), `severity_max` (highest incident severity the level admits), `max_concurrent` (maximum active incidents at once). A scenario inherits its row through its `level` field; a scenario with `level: null` carries its own `difficulty` block instead. |
| `data/scenarios/` | One file per scenario, each a single JSON **object** (not wrapped in an array). A scenario declares the board the player starts with, what they may build (`allowed_layers`), how incidents arrive (`incident_source`), and how the session ends (`end`). Validated by `checkScenarioRefs`, `checkScenarioProgression` and `checkScenarioBoards` in `src/validate/scenarioChecks.ts`. See §15 for the three modes (level, standalone, free play) and how to add one. |
| `data/tags.json` | 48 tags in four kinds: 20 weakness, 16 capability, 9 property, 3 posture. Tags are the closed vocabulary for describing a node's current state and for gating actions. |
| `data/incidents/` | 50 incidents across 7 family files. Each file is a JSON object with a top-level `incidents` array. The 7 families and their counts are hardcoded in `src/validate/incidentChecks.ts` and asserted in `tests/incidentIntegrity.test.ts`. |
| `data/layers.json` | 7 architectural layers. Four (edge → ingress → compute → data) are on the request path with `layer_index` 1–4. Three (reliability, observability, delivery) are off-path with `layer_index: null`. |
| `data/nodes/` | 7 files, one per layer, holding 26 nodes and 80 tiers total. Each file is a JSON **object** with a single top-level `nodes` array — `{ "nodes": [ ... ] }`. Nothing is keyed by layer name; a node states its own layer in its `layer` field, and the filename is a convention only. |
| `data/actions.json` | 33 actions. Each action carries a `constraint` predicate that determines which nodes and tiers it appears on. Actions are NOT stored per-node. |
| `data/metrics.json` | 7 metrics (4 technical, 3 business) plus an `economy` block holding the global pricing and balance coefficients. Technical: `uptime_pct`, `p95_latency_ms`, `error_rate_pct`, `reputation`. Business: `users`, `cost_month`, `profit_month`. |
| `data/minigames/formats.json` | 7 interaction format definitions. Each format declares the levers it supports, with a type and `min`/`max`/`values` for each — though only lever **names** are enforced anywhere, not their values. It does **not** declare `wrong_outcomes[].when` legality; that map lives in `tests/helpers/dataFiles.ts`. |
| `data/minigames/registry.json` | 20 minigame entries, each carrying exactly four fields: `id`, `name`, `format`, `description`. A minigame does **not** declare its own difficulty — difficulty comes from the action that invokes it, which is why the difficulty-slot rule in §14 is enforced across files rather than inside this one. |
| `data/minigames/instances/` | 7 instance files (`a-sequence.json` through `g-log-hunt.json`), one per format. 52 instances total across 29 difficulty-slots. Each instance carries both format-agnostic fields (`brief`, `teaches`, `wrong_outcomes`, `reveal`) and format-specific fields (`given`, `solution`, optional `distractors`, `levers`). |

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

3. **Update the node count in three places.** `src/validate/integrity.ts` hardcodes `if (c.nodes.length !== 26)` (check 3), `tests/integrity.test.ts` asserts 26 twice (`loads 26 nodes`, `has unique node ids across every file`), and `tests/engine.catalog.test.ts` asserts all nine catalogue counts including `nodes`. A 27th node fails `npm run validate` and `npm test` until all four locations are updated. The same applies to tags: adding one to `data/tags.json` requires updating the count assertion in `tests/tags.test.ts` (currently 47) **and** in `tests/engine.catalog.test.ts` (`c.tags.toHaveLength(47)`).

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

**Count assertions live in three test files.** `tests/tags.test.ts` asserts the tag count (currently 47). `tests/integrity.test.ts` asserts the node count. `tests/engine.catalog.test.ts` asserts all nine catalogue counts — nodes, layers, tags, actions, metrics, incidents, formats, minigames, minigameInstances — so a new tag requires updating both `tests/tags.test.ts` and `tests/engine.catalog.test.ts`. Run `npm test` to confirm both pass.

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

**`minigame_pool`** (optional) lists extra `{ minigame, difficulty }` slots for the same action. The action's own `minigame`/`difficulty` is slot 0. `src/engine/minigamePick.ts` picks one slot and one instance from `(rng_seed, action id, context key)` — the incident record key, the ticket id, or `<instanceId>:<tick>` from the inspector — so a run replays exactly while different incidents see different puzzles. Every pool slot is a difficulty-slot: `checkSlotCoverage` and `checkRegistryMatchesActions` iterate `slotsFor(action)`.

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

The `p95_latency_ms` formula is `sum(path.base_latency_ms * saturation_curve(path.utilization_pct / 100))`. `path` is the set of nodes on the **synchronous request path**, defined as:

> A node is on the synchronous request path **if and only if** its layer has `on_request_path: true` in `data/layers.json`, **and** the tier does not carry the `async` or `scheduled` property tag.

Four layers are on-path: `edge`, `ingress`, `compute`, `data`. The three off-path layers (`reliability`, `observability`, `delivery`) have `layer_index: null` and are never in the sum.

**`data/layers.json` is the single source of truth for this. There is no per-node tag for it and there must not be one.** An `on_request_path` tag used to exist in `data/tags.json` and was applied to only 7 of the 38 on-path tiers. Anyone filtering on the tag computed latency from the app tier alone and under-reported p95 by well over half (at tier 1 across the full path, 165 ms of 398 ms — a 58% under-report), silently — while anyone filtering on the layer boolean got a different answer. The tag was deleted precisely because two sources of truth for one fact is the bug. Do not reintroduce it: layer membership plus the `async`/`scheduled` exclusion already answers the question completely.

The same `path` set drives `error_rate_pct` (`clamp(max(path.utilization_pct / 100 - 1) * 40, 0, 100)`).

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

20 minigame ids are referenced by `data/actions.json`. They are skins over **7 shared interaction formats**, not 20 distinct mechanics. Research on comparable games found that mechanical variety saturates at 3–5 primitives — a single mechanic with only a difficulty dial (faster, more steps) hits fatigue quickly, while games that vary puzzle *structure* over a fixed primitive sustain much longer play. Twenty distinct mechanics would impose a new learning curve every few encounters and buy no depth. The seven formats cover the operations that matter: ordering, quantitative judgement, configuration, topology, evidence interpretation, shell command recall, and log root-cause identification.

### The six interaction formats

| Format id | What the player does | Why this format |
|---|---|---|
| `ordered_sequence` | Drag steps into the correct order | Order is operationally consequential: a DNS cutover, a restore, and a certificate chain each have one right sequence. Putting them out of order produces a real failure mode. |
| `fill_blank` | Fill in missing values in a config or manifest | YAML configs, cache keys, IAM policies, and incident comms are the actual artefacts engineers produce. The blank is where judgement lives. |
| `dial` | Move a slider to the correct quantitative threshold | Thresholds, replica counts, and instance sizes are continuous judgement calls with cost consequences in both directions. |
| `wiring` | Connect nodes to form a valid topology | Dependency and network topology errors are a class of problem that a form cannot represent; spatial arrangement is the right primitive. |
| `evidence` | Choose the correct root cause from a set of signals | Slow queries, bad deploys, and crash logs require reading evidence and ruling out distractors — interpretation, not configuration. |
| `terminal` | Type the rest of a shell command to fix the incident | CLI commands are the actual remediation interface engineers use; reading prior output and recalling the right argument tests real operational recall. |
| `log_hunt` | Click the single root-cause line in a scrollable log | Cause vs. blast-radius is the core skill of first-response incident work; the format trains the player to ignore downstream cascade errors and find the first failure. |
| `patch` | Edit exactly one line of a real config file | Config files are the actual artefacts engineers change during incident response; the one-line constraint forces the player to make a precise targeted edit rather than rewriting the file. |
| `monitor` | Click the right metric inside the threshold-crossing window | Real-time reaction to a crossing event — tests whether the player watches the correct signal and acts within the window, distinguishing the meaningful metric from decoys. |
| `classify` | Drag items from a tray into labelled bins by the stated rules | Categorisation is the core operational skill behind alert routing and observability pillar selection; HTML5 drag-and-drop with click-to-place fallback. |

### The difficulty-slot rule

Every instance carries a `difficulty` field. That difficulty must be a level at which some action in `data/actions.json` actually invokes the instance's minigame — otherwise the instance is content the engine can never select. `query_plan_puzzle`, for example, is only ever called at difficulty 3; an instance at difficulty 1 or 5 sits in an unreachable pool.

32 difficulty-slots exist across the 23 minigames. `checkSlotCoverage` (run under `npm run validate`) enforces that each slot has at least one instance. An action reaching an empty pool fails at runtime, not at authoring time — so validation is the only net.

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
| `terminal` | `prefix` (non-empty string), `history` (non-empty array) | `accepts` (non-empty array of non-empty strings) |
| `log_hunt` | `source` (non-empty string), `lines` (non-empty array of `{ts, level, text}` objects) | `line` (positive integer, 1-based index of the root-cause line); optional `accept` (more 1-based lines graded correct — use when the cause repeats, e.g. every copy of one slow query) |
| `patch` | `filename` (non-empty string), `language` (non-empty string), `content` (non-empty string — the full file text) | `line` (positive integer, 1-based; only this line may change); `must_contain` (non-empty array of non-empty strings — normalised target line must contain each); optional `must_not_contain` (string array — normalised target line must contain none) |
| `monitor` | `metrics` (non-empty array of `MonitorMetric` objects with `id`, `label`, `unit`, `start`, `slope`, `amplitude`, `period_s`), `duration_s` (positive number), `rule` (non-empty string) | `metric` (non-empty string — the id of the solution metric), `threshold` (number), `direction` (`above`\|`below`), `window_s` (positive number) |
| `classify` | `items` (non-empty array of `{id, label}`), `bins` (non-empty array of `{id, label}`) | `bins` (object: item id → bin id; all strings) |

**It requires presence and type; it does not reject extra keys.** Instances legitimately carry optional extras — `facts`, `options`, `language`, `context`, `edges` — and rejecting unknowns would fail valid data. Requiring the known keys is what catches a typo: `{"vlaue": 5}` leaves `value` missing, and the check names the instance and the field.

If you add a format, **add its row to `SHAPE_BY_FORMAT` in the same change**, or its instances get no payload validation at all.

This check was added after a review found the gap. Before it, `"solution": {"choise": "..."}` on an evidence instance passed the schema, every check, every test, and `npm run validate` — because the per-format test files were the only coverage and `tests/minigames.evidence.test.ts` never referenced `solution`. Per-format tests remain valuable for the *semantic* cross-checks a shape table cannot express (that `solution.value` falls inside `given.range`, that `connect_to` names nodes that exist), but they are no longer the only line of defence.

### The teaching loop

The player gets unlimited retries. On each failure, the engine matches the wrong answer against `wrong_outcomes` and shows the matching `shows` text alongside the metric consequence. The `on_fail` penalty applies per attempt. After the **third** failure the UI shows `solution` and `reveal` in full — the player still executes the action and still pays the time cost, but leaves knowing why.

**A cap on repeated-failure `on_fail` damage needs to be built into the engine** when the incident loop is implemented. A player on attempt four is the one most in need of teaching rather than punishing, and no floor exists yet. Record this as a required engine-side constraint; do not work around it in data by zeroing out `on_fail`.

### How to add an instance

1. **Pick the format file** (`data/minigames/instances/a-sequence.json` through `j-classify.json`). The file name encodes the format.
2. **Use only levers that format declares** in `data/minigames/formats.json`. An undeclared lever key is a **hard failure in two places** — `checkInstanceRefs` under `npm run validate` and `expectValidInstanceFile` under `npm test`. Only the JSON schema ignores it. Note the converse is *not* enforced: nothing checks lever **values** against the `min`/`max`/`values` the format declares, so `"tolerance_pct": 95` passes both commands today. Stay inside the declared bounds by hand.
3. **Cover a slot that exists.** A minigame does **not** declare its own difficulty — there is no `difficulty_range` field anywhere. The legal difficulties for a minigame are exactly those at which some action in `data/actions.json` names it; §14's slot table is derived from that file and nothing else. `expectValidInstanceFile` rejects a difficulty no action demands, and `checkSlotCoverage` reports a demanded slot with no instance.
3a. **Restrict with `for_actions` when a minigame is pooled into dissimilar actions.** `for_actions` (optional) limits an instance to the listed actions — a Redis-flush terminal puzzle must not open for a rollback. `checkSlotCoverage` requires every (action, slot) pair to have at least one eligible instance, and `checkForActionsRefs` rejects an id that is not an action or whose action never selects the instance's slot. Instances without `for_actions` serve every action that selects their slot.
4. **Write a `teaches` that is transferable.** The `teaches` field should state a principle the player can apply elsewhere — "CPU requests are specified in 25m steps, rounded up from measured steady-state" — not a restatement of the answer — "the answer is 250m". The latter turns a judgement problem into transcription.
5. **Give every dial instance both a `below` and an `above` outcome.** A dial has two failure directions; both carry real lessons (under-provisioned fails, over-provisioned wastes money). An instance with only one is incomplete.
6. **Check `wrong_outcomes[].when` values against the format.** Legal values are: `any` (all formats) · `below`/`above` (`dial` only) · `wrong_order` (`ordered_sequence` only) · `wrong_value` (`fill_blank` only) · `wrong_target` (`wiring` only) · `wrong_choice` (`evidence` only) · `wrong_command` (`terminal` only) · `wrong_line` (`log_hunt` only) · `wrong_edit`/`collateral_edit` (`patch` only) · `too_early`/`too_late`/`wrong_metric` (`monitor` only) · `wrong_bin` (`classify` only). A `when` value from the wrong format will not fail schema validation — it will produce an outcome the engine never matches.
7. **Never mix `any` with a format-specific value** in the same instance's `wrong_outcomes`. An instance may use `any` alone, or one or more specific entries, but `any` mixed with a specific entry leaves the engine unable to determine which to show. Most formats have only one legal specific value, so a single specific entry is the normal shape; `dial` is the exception and needs both `below` and `above`.

   The legality of `when` per format is **not** declared in `formats.json` — it lives in `WHEN_BY_FORMAT`, exported from `src/validate/minigameChecks.ts` and imported by the test helper, and the schema's `when` enum is the flat union of all seven values across all formats. Editing `formats.json` will not change `when` legality. `checkWhenLegality` enforces it under `npm run validate`.

### Authoring standards

**`reveal` explains the mechanism, not the answer.** It is what the player reads after three failures. "A 250m request on a 500m node leaves headroom for bursts" is a mechanism; "The correct answer is 250m" is a label. The player already knows the correct answer at that point — they need to understand why.

**`wrong_outcomes[].shows` uses concrete numbers moving in the wrong direction.** "p95 climbs to 340 ms as the cache misses compound" is concrete; "performance degrades" is not. The player needs to see the consequence, not hear that one exists.

**A wrong answer that works but wastes money is a real lesson.** The cost model exists to express it. For a resource dial, over-provisioning is typically the `above` direction; for a scale-up threshold, the wasteful direction is `below`, where the autoscaler thrashes. Identify which direction represents waste for *this* instance and author that outcome explicitly.

**An instance is only a judgement test if the judgement is derivable from what the player is shown.** Every answer must follow from that instance's own `brief` and `given`. Two instances shipped violating this: one answered `250m` while its own facts said `235m`, and one required a 24-hour window with nothing on screen distinguishing 24 from 12 or 48. Both had to be fixed. Marking correct reasoning wrong is the worst failure available in a teaching tool.

**Supply the missing rule, not the missing answer.** When fixing an instance where the player cannot derive the answer, the fix is to add the rule to `given` ("CPU requests are specified in 25m steps, rounded up from measured steady-state") — not to embed the answer in the table. Adding the answer turns a judgement problem into transcription.

### AI-rewritable fields

Each format in `data/minigames/formats.json` carries an optional `ai_fields` array declaring the paths the AI may rewrite. The first five formats (`ordered_sequence`, `fill_blank`, `dial`, `wiring`, `evidence`) expose `["brief", "wrong_outcomes[].shows"]`. Later formats may expose additional paths such as `given.history` or `given.rule`.

**`solution` is never rewritable.** It is not a valid `ai_fields` path and `applyAiPatch` (`src/engine/aiMerge.ts`) explicitly skips it even if it were passed, ensuring the authored answer is always preserved and the instance remains gradeable.

A patch is accepted only if it passes `validateAiPatch`. The four rules:

1. **Unknown keys** (paths not in `ai_fields`) are reported but do not cause failure — they are silently dropped by `applyAiPatch`.
2. **Type and length match** — a string field requires a string; a string-array field requires a string array of the same length.
3. **Numbers preserved** — every number that appears in the original text must appear in the rewrite (regex `/\d+(?:[.,]\d+)?/g`, commas stripped). This ensures facts the answer depends on survive.
4. **Clean strings** — no `{{`/`}}` template braces may remain; each string must be ≥ 20 and ≤ 700 characters.

If any known-key check fails, the whole patch is rejected and the authored instance is used unchanged.

### Counts at a glance

| What | Count |
|---|---|
| Interaction formats | 10 |
| Minigames | 23 |
| Instances | 61 |
| Difficulty-slots | 32 |
| Difficulty levers across all formats | 23 |

---

## 15. Engine — `src/engine/`

This section covers the runtime engine that loads, evaluates, and projects the data defined in `data/`. Read it before editing any file under `src/engine/`.

### File map

| File | Responsibility |
|---|---|
| `src/engine/types.ts` | Public contract the UI imports. No logic — only type and constant declarations (`PhaseId`, `MetricId`, `Status`, `GameState`, `NodeInstance`, `IncidentRecord`, `LedgerEntry`, `SessionState`, `BoardNodeView`, `MetricReadingView`, `PortFillView`, `ScenarioDef`, `EndCondition`). |
| `src/engine/catalog.ts` | Loads all of `data/` and deep-freezes every object. Exports `loadEngineCatalog()` (Node-only I/O wrapper), `catalogFrom(rawData)` (pure constructor for browser use), and `deepFreeze`. |
| `src/engine/formula.ts` | Hand-written recursive-descent evaluator for the formula strings in `data/metrics.json`. Exports `evaluateFormula`. |
| `src/engine/ports.ts` | Capability and port matching. Exports `autoWire`, `portFills`, `unsatisfiedPorts`. |
| `src/engine/scenario.ts` | Loads a scenario file and constructs the initial `GameState`. Exports `loadScenario`, `scenarioById(id, catalog)`, `instanceIdFor`, `scenarioFrom`. |
| `src/engine/metrics.ts` | Builds the formula scope and evaluates all seven metrics in dependency order. Exports `buildScope`, `deriveMetrics`, `onRequestPath`. |
| `src/engine/view.ts` | `boardOf` and `metricsOf` projections that translate `GameState` + `EngineCatalog` into the view models the UI renders. Also exports `statusOf`, `nodeStatusOf`. |
| `src/engine/rng.ts` | Deterministic 32-bit xorshift PRNG expressed as pure functions. Exports `nextFloat`, `nextInt`, `seedFrom` (FNV-1a hash of a string), `rngFrom` (splitmix32-finalised seed constructor — prefer over `{ seed: n }` directly). |
| `src/engine/difficulty.ts` | Resolves a scenario's difficulty: reads the level row from `data/levels.json` or the scenario's own `difficulty` block if `level: null`. Exports `difficultyFor`. |
| `src/engine/arrival.ts` | Geometric arrival probability, weighted incident selection, and instance targeting. Exports `shouldArrive`, `selectIncident`, `targetsOf`, `weightOf`, `eligibleIncidents`. |
| `src/engine/damage.ts` | Health delta and tag application for a given set of instance ids. Exports `affectedInstanceIds`, `applyDamage`. |
| `src/engine/ledger.ts` | Prices ledger events using `economy` coefficients. Exports `ledgerEntriesFor`, `priceLedgerEvent`. |
| `src/engine/tick.ts` | The clock. `advance(state, dtTicks, catalog): GameState` loops `dtTicks` times, applying arrivals → per-tick ledger → escalations → expiries → cooldowns → metrics → bookkeeping in that per-tick order. Refuses a non-`run` phase. |
| `src/engine/session.ts` | Phase transitions and end-condition evaluation. Exports `canStartRun`, `startRun`, `isSessionOver`, `endSession`, `runSession`. |

### The engine never imports from `src/ui/`

The dependency runs one way: UI → engine. `tests/engine.types.test.ts` enforces this by scanning every engine file for the import pattern. Adding a `src/ui` import to any engine file makes the engine unshippable without the UI present and breaks the test suite's isolation guarantee. A parallel session owns `src/ui` — never edit it.

### Browser bundleability

Every engine module except `catalog.ts` is guaranteed browser-bundleable — they must never import `node:*` modules. `loadEngineCatalog` in `catalog.ts` **does** use Node I/O and is intentionally excluded; the browser uses `catalogFrom` instead. The `check:browser` script in `package.json` enforces this by bundling `$(ls src/engine/*.ts | grep -v catalog.ts)` with esbuild — a glob rather than a hand-listed set, so new modules are covered automatically without editing the script. `catalog.ts` is the one deliberate exclusion.

### Purity

The engine has no side effects: no `Date.now()`, no `setInterval`, no DOM reads. The caller owns real time and calls `advance` when a tick should fire. This is why every engine test is a plain synchronous assertion with no fake timers needed.

### The frozen catalogue

`loadEngineCatalog()` is a thin Node-only wrapper that reads the data files and calls `catalogFrom(rawData)`. `catalogFrom` is a pure constructor that takes already-parsed arrays — the browser calls it after fetching the data files over HTTP. Both paths call `deepFreeze` on the entire return value, including `scenarios` and the `scenarioById` index. A write to a definition object in strict mode throws immediately, at the call site, rather than silently mutating shared state. This makes the two-layer rule (§2) mechanical: it was documented-but-unenforced since cycle 1, and the freeze is what closed that gap.

The `EngineCatalog` property holding minigame instances is `minigameInstances` (not `instances`). The rename avoids a collision with `GameState.instances`, which are per-save node instances — a different concept entirely.

**Three caveats that cost real debugging time:**

- **Freezing always protects the value; it only *throws* in strict mode.** ESM modules are strict by spec, so every real consumer gets the loud behaviour — but a write from a non-strict context fails silently with the value unchanged. If you are debugging an ignored write and the freeze appears broken, check whether the calling module is strict.

- **Index maps must share object references with their source arrays.** A shipped defect had `layerById`, `tagById`, and `actionById` built from a second `loadJson` call. Even though those arrays were frozen separately, the Map entries held distinct object references from a separate parse — so `catalog.layerById.get('edge').on_request_path = false` succeeded silently while `Object.isFrozen(catalog.layers[0])` returned `true`. A frozenness assertion passed on the broken code. The defect was found because `deepFreeze` at the time traversed only via `Object.values`, which returns `[]` for a `Map`, leaving Map entries unfrozen — surfacing the gap only when a test on a Map entry was added. `deepFreeze` now traverses Map and Set values explicitly, but the underlying rule stands: **a Map built from a second parse holds different objects than the frozen array, regardless of whether those objects are also frozen**. If you add an index, build it from the same array reference and test **reference identity**, not just frozenness.

- **`Object.freeze` cannot make a `Map` immutable.** `map.set(...)` still succeeds; the `ReadonlyMap` types in `catalog.ts` are compile-time only. This is an accepted limitation, not an oversight — a Proxy or bespoke collection type was judged disproportionate.

### The formula evaluator

`eval` and `new Function` are prohibited. These strings are authored data, and an evaluator that can reach the runtime is an injection surface. The evaluator is a hand-written recursive-descent parser limited to an allowlist of six functions: `sum`, `min`, `max`, `clamp`, `saturation_curve`, `decay`. **An unknown identifier throws** — a formula that silently reads zero produces a plausible wrong number, which is worse than a crash.

Identifier lookup uses `Object.prototype.hasOwnProperty`, not `=== undefined`. A shipped defect let `constructor` resolve through the prototype chain, handing a formula a *function*. `toString`, `valueOf`, and `__proto__` were equally reachable. The `hasOwnProperty` guard closes this.

Dotted identifiers (e.g. `path.base_latency_ms`) are vectors — one element per matching node. Bare identifiers are scalars. Operators broadcast elementwise across mixed scalar/vector pairs. **The top-level result must reduce to a single number** — a formula that evaluates to a vector throws.

### `saturation_curve` — polynomial, not reciprocal

`saturation_curve(u)` is `1 + (max(0, u - knee) / (1 - knee)) ** exponent`. With the shipped `saturation_knee: 0.8, saturation_exponent: 3.0` that is ×1.00 up to 80% utilisation, ×1.12 at 90%, ×2.00 at 100%, ×16.6 at 130%.

**If latency ever explodes absurdly, check this first.** A reciprocal of `(1 - u)` gives ×296 at 97% utilisation and ×8,000,000 at 100%. The comment in `src/engine/formula.ts` records why the reciprocal form was rejected.

### The monthly-rate time base

`reputation_growth_rate`, `latency_churn_rate`, and `outage_churn_rate` are monthly rates. Formulas evaluate per tick and `tick_seconds` is 5, so `metrics.ts` divides all three by `ticks_per_month = 2_592_000 / tick_seconds` before applying them.

**The known consequence:** over a 40-tick session users move about 0.00023% (per-tick growth = 0.03 / 518,400 = 5.787e-8; × 40 ticks = 2.31e-6), so the business metrics appear frozen. This is a balance problem, not an engine bug — a test in `tests/engine.metrics.test.ts` pins the magnitude deliberately so removing the division is immediately visible. The fix is a balance decision: raise `tick_seconds`, lengthen the session window, or reinterpret the rates as per-tick rather than monthly.

### `Status` is engine-owned — the UI must never re-derive it

`statusOf` (for metrics) and `nodeStatusOf` (for nodes) are the only places status is computed.

**Metric status** comes from `healthy_range`: `ok` if the value is inside `[lo, hi]`; `warn` if the overshoot past the breached bound is within half the range width; `bad` beyond that. `statusOf` deliberately does not read `direction` — the overshoot formula is symmetric, and which bound fires already encodes the direction. Do not "fix" it by adding a direction branch. If a threshold feels wrong, change `data/metrics.json` so both sides move together.

**Node status**: `bad` if `down` or health ≤ 0; `warn` if health < 60 or utilisation at or above the 80% saturation knee; `ok` otherwise.

### Port disjointness invariant

A node's `requires` ports must accept disjoint capability sets. `ports.ts` counts a port's fill by re-testing `accepts` against the consumer's edges; overlapping ports would share edges and one could report more fills than its own `max`. `checkPortAcceptsDisjoint` in `src/validate/integrity.ts` enforces this under `npm run validate`. If a future data cycle genuinely needs overlapping ports, the engine must change first.

### `instanceIdFor` — the canonical instance-id rule

`instanceIdFor(defId, n)` in `scenario.ts` produces `<def_id with underscores replaced by hyphens>-<n>`, numbered from 1 in board order. `view.ts` calls it to key authored `x`/`y` positions. If the two implementations ever disagree, every position lookup misses, nodes silently fall back to `{0, 0}`, and the board renders as a pile at the origin with nothing failing. A drift-guard test in `tests/engine.view.test.ts` asserts each view's position equals its authored board entry.

### Starting users

50,000 users is hardcoded in `scenario.ts` as `carried: { reputation: 100, users: 50000 }`. The `users` formula reads its own previous value each tick, so it must start somewhere. This is the single place it lives. The fix, if scenarios ever need to vary it, is a `starting_users` scenario field — there is no such field today, and nothing else should read or set this value.

### How to add a scenario

Scenario files go in `data/scenarios/`, validated by `data/schema/scenario.schema.json`. Three modes share one file shape:

| Mode | Markers |
|---|---|
| **Level** | `level` is a non-null integer; `incident_source: "scripted"`; `end.kind: "fixed_window"` |
| **Standalone scenario** | `level: null`; otherwise same as a level |
| **Free play** | `incident_source: "weighted"`; `end.kind: "endless"`; `incidents: []` |

`end.kind` is a closed enum — `fixed_window`, `endless`, `objectives` — but only `fixed_window` is implemented. `allowed_layers` bounds what the player may build; nodes outside it are rejected by `checkScenarioBoards`.

`npm run validate` enforces:
- **`checkScenarioProgression`** — `unlocked_by` may not name a missing scenario or itself; a `scripted` scenario must have at least one incident; a `weighted` scenario must have none.
- **`checkScenarioBoards`** — every board entry names a real node in an allowed layer, within `max_instances`; and as a runway check, the board's total monthly `cost_month` must not exceed the scenario's `starting_budget` credits, or the scenario is unsustainable from the first month.

### Engine functions: what exists today

These functions are implemented and tested. The UI session can call any of them:

```
loadEngineCatalog    catalogFrom        evaluateFormula    autoWire
portFills            unsatisfiedPorts   loadScenario       scenarioById
instanceIdFor        buildScope         deriveMetrics      onRequestPath
boardOf              metricsOf          statusOf           nodeStatusOf
difficultyFor        advance            canStartRun        startRun
isSessionOver        endSession         runSession
```

`advance(state, dtTicks, catalog)` takes the catalogue as a third parameter (the older handoff doc wrote `advance(state, dtTicks)` — this corrects that).

The following functions appear in the engine spec and handoff but belong to Plan B and do not exist yet:

```
actionsFor         gradeAnswer        applyOutcome
provision          decommission       signalsFor
designSummary      debriefSummary     tierLadder
```

### Level and scenario validation

`src/validate/levelChecks.ts` enforces three cross-file rules for `data/levels.json`:
- **`checkLevelShape`** — levels must be contiguous from 1, unique, and monotonically harder: `arrival_mean_ticks` must not increase (equal adjacent values pass — the check is non-strict), `severity_max` must be non-decreasing, `max_concurrent` must be non-decreasing across levels.
- **`checkLevelIncidentCoverage`** — every level must admit at least one incident (severity ≤ `severity_max`). A severity cap that matches nothing produces a level where nothing can ever happen — the analogue of the minigame difficulty-slot check.
- **`checkScenarioLevelRefs`** — every scenario that names a `level` must name one that exists; a scenario with `level: null` must carry its own `difficulty` block.

`src/validate/scenarioChecks.ts` enforces three more rules:
- **`checkScenarioRefs`** — every `board` entry names a real node, every `incidents` entry names a real incident, no duplicate scenario ids, and no scripted incident fires at or after the session window ends.
- **`checkScenarioProgression`** — `unlocked_by` may not name a missing scenario or itself; a `scripted` scenario must have at least one incident; a `weighted` scenario must have none.
- **`checkScenarioBoards`** — every board entry names a real node in an allowed layer, within `max_instances`; and the board's total monthly `cost_month` must not exceed the scenario's `starting_budget`.

### Cycle decisions — what breaks if you undo these

These were measured defects during this cycle. Each is recorded here because the symptom is non-obvious.

1. **Seed scrambling in `startRun`.** A raw small integer seed is pathological for xorshift32: its first output is ~`seed * 6.3e-5`, so `nextInt` returns 0 and every weighted arrival fires on tick 1 for seeds 1–399 at level 1, up to 1–1343 at level 5. `startRun` calls `rngFrom(seed)` before entering the session — a splitmix32 finaliser that distributes the seed. `advance` treats `rng_seed` as an **already-scrambled** stream position and does **not** call `rngFrom` again, because re-scrambling on every `dtTicks=12` call would produce a different result than twelve `dtTicks=1` calls, breaking the looping-equivalence test. `startRun` is the one boundary; never construct `{ seed: n }` from a caller-supplied integer by hand.

2. **`per_tick` ledger events carry `cadence: 'once'`, not `'monthly'`.** A `per_tick` event is a fresh one-off charge created each tick. Marking it `monthly` made `cost_month` sum the same charge once per elapsed tick: −499,885 over 40 ticks. `'monthly'` is reserved for a standing charge appended once; nothing emits one yet.

3. **`cost_month` adds the ledger's magnitude, not its signed amount.** `LedgerEntry.amount` is negative by convention (it is a charge). `metrics.ts` negates it when building the `ledger.recurring` vector. Without that negation, a charge reduced `cost_month` and raised `profit_month`.

4. **`check:browser` is a glob**, not a hand-listed set. The hand-listed set silently stopped covering five modules when new engine files were added. The current script is `$(ls src/engine/*.ts | grep -v catalog.ts)`. New modules in `src/engine/` are covered automatically. Do not add `session.ts` or any other new module by name.

### Tick loop — things that are not rearrangeable

The per-tick order in `advance` is: arrivals → per-tick ledger → escalations → expiries → cooldowns → metrics → bookkeeping. This order is not arbitrary:

- Metrics derive **last** because steps 1–5 change what they read: health, incidents, and ledger all land before the formula scope is built.
- `reputation` needs this tick's incident set because `incident_severity` is summed from active incidents rather than stored separately.
- **`dtTicks` loops; it never multiplies.** Scaling a single tick's effects by `dtTicks` would skip escalation thresholds, land expiries on the wrong tick, and fire per-tick ledger events once instead of `dtTicks` times.
- **Arrival damage applies once, not every tick.** `health_delta` is a one-off shock applied at the tick the incident arrives. Only `ledger_events` with `when: per_tick` recur. Re-applying `health_delta` each tick destroys a board within a few ticks.
- **Architecture-scope incidents damage nothing.** Their `health_delta: -5` exists only because the schema requires a non-empty `damage` block; it is applied to no instance.
- **Utilisation has no upper clamp.** Values above 100 are what drive `error_rate_pct` through the saturation curve. Capping at 100 would silently remove saturation.

### One fix clears everything it fixes

`applyOutcome` (in `src/engine/grading.ts`) resolves, on a correct answer, the incident the minigame was opened from — **every record of that key**, since a group incident has one record per instance — **plus every other active incident on the same instance whose `resolved_by` lists the action**. That holds when the fix was launched from a ticket or the inspector (`incidentKey: null`). Each resolved key emits its own `on_resolve` ledger entries and counts once in `incidents_resolved`. Tickets need no equivalent: `isTicketComplete` re-checks every open ticket each tick, so one action that satisfies two tickets completes both.

### Generated puzzle facts — `buildSeedContext`

`buildSeedContext(seedKey)` in `src/engine/template.ts` derives per-incident facts from the context key (the incident record key, `ticket:<id>`, or `<instanceId>:<tick>`): `entity_id`, `tenant`, `key_prefix`, `revision`, `pid`, `deploy_version`, `region`, `ip_octet`, `db_index`. The UI merges them under the live node/incident context before resolving an instance, so authored instances can put `{{key_prefix}}:{{entity_id}}:*` or `{{revision - 1}}` in their `given` **and** `solution`: each incident shows different details and a different answer, and the same incident always shows the same ones. Grading reads the resolved instance, so templated answers grade as their substituted values.

### Known gaps (deliberate, not bugs)

1. **`fires_when` posture predicates are not evaluated.** Architecture-scope incidents are admitted on severity and gates alone. An architecture incident may fire even when the posture gap it describes does not exist in the current board.
2. **Nothing resolves an incident.** 44 of 49 incidents have no `duration_ticks` and persist once they arrive. A run degrades and scores; the player has no agency yet. `max_concurrent` and the session window are what bound a run. Actions and minigames belong to a later plan.
3. **`endless` and `objectives` throw.** They are declared in the `EndCondition` enum and unimplemented. A session that cannot end looks like a hang rather than a missing feature, so they throw a clear error rather than silently looping.

### Wave A behaviour changes — traps for the next cycle

Four behaviours differ from the original plan spec. Each is recorded here because the symptom is non-obvious and the cause is an easy revert target.

1. **`metricsOf` reads recorded history rather than re-deriving.** `view.ts` returns the last entries from `state.history` instead of calling `deriveMetrics` again. Re-deriving would double-apply one tick of `reputation` decay: the `carried.reputation` going into the formula scope is already this tick's output, so evaluating the formula a second time would produce `reputation * decay^2` rather than `reputation * decay^1`. Reading history avoids this without special-casing `reputation`.

2. **A group incident is N records sharing one key.** Group-scope arrivals create one `IncidentRecord` per affected instance, all carrying the same `key`. The per-tick ledger, escalation, and expiry steps group records by `key` and process each key-group as a unit — so a group incident charges once (with the full affected-instance list), escalates once, and expires once, regardless of how many instances it covers.

3. **Scripted arrivals ignore `max_concurrent`; weighted arrivals respect it.** In `tick.ts`, the `if (incidents.length < difficulty.max_concurrent)` guard wraps only the weighted arrival branch. Scripted arrivals (authored at explicit ticks) fire unconditionally — the authored schedule is authoritative, and silencing a scheduled incident because of an active one would make scripted scenarios non-deterministic.

4. **Escalating into architecture scope clears `instance_id`.** When an incident escalates to an architecture-scope target, the escalated record carries `instance_id: null` even when the source incident was bound to a specific node. Architecture-scope incidents describe a system-wide posture gap, not a per-node failure, so retaining an `instance_id` from the source incident would be misleading and could confuse the UI.

### Specs and handoff

Full design spec: `docs/superpowers/specs/2026-09-19-engine-core-design.md`
Engine-to-UI contract: `docs/handoffs/2026-09-19-engine-to-ui-contract.md`

---

## 16. Tickets

Tickets are global definitions in `data/tickets.json` — identical for every player and every save, loaded once, never mutated at runtime. Instance state (active_tickets) tracks per-save progress on top of these definitions.

### Requirement shapes

Every ticket has exactly one requirement shape:

- **Shape A** — `node_id + min_tier`: completed when the named node is at or above `min_tier`. Primary hint must be `upgrade_tier` (enforced by `checkTicketHints` rule 3).
- **Shape B** — `node_id + min_count`: completed when at least `min_count` instances of `def_id` exist on the board. Since nodes cannot be added during the run phase, every scenario listing a min_count ticket must already have enough board entries.
- **Shape C** — `layers + tags_any` or `layers + tags_all`: completed when any node in the named layers has all the required tags (via tier definition tags or instance `tags_runtime`).

### Rules enforced by `checkTicketHints` (src/validate/ticketChecks.ts)

1. `hint_actions` is non-empty and every id exists in `data/actions.json`.
2. The primary hint (`hint_actions[0]`) is offered on at least one node/tier that satisfies `node_id` (if set) and `layers` (if set).
3. The primary hint can satisfy the requirement: `upgrade_tier` for `min_tier`; the action must grant a required `tags_any` tag; for `tags_all`, each required tag must be granted or already exist on a candidate tier; for `min_count`, every scenario listing the ticket must already have enough instances on the board.
4. Per scenario listing a ticket: at least one board node is among the candidate nodes for the primary hint.
5. Every `ticket_ids` entry in every scenario must exist in `tickets.json`.
6. `upgrade_tier` is the primary hint for at most 6 scenario-listed tickets; any other action is primary for at most 3.

**A ticket the run phase cannot complete is dead content.** Tickets that require nodes absent from every scenario board (`min_count` on a node not on the board) or hint actions that cannot match any board node are caught and reported as errors by `checkTicketHints`.

### Orphaned tickets

A ticket in `tickets.json` that is not listed in any scenario's `ticket_ids` is still validated by rules 1–3 but is exempt from rules 4 and 6 (which are per-scenario or count scenario-listed tickets only). Orphaned tickets exist for completeness but the player never sees them.

---

## 17. Stakeholder messages and the pager

**Stakeholder messages** (`data/stakeholders.json`) are the social pressure of an incident. `src/engine/stakeholders.ts` is pure: `dueStakeholderMessages(state, catalog, lastShownTick)` returns messages whose trigger holds (read from the latest `state.history` value, or from active incident severities) and whose `cooldown_ticks` has passed; `applyStakeholderResponse` clamps reputation to 0–100 and moves budget exactly as action costs do (it may go negative); `ignoredResponse` is the response with the lowest `reputation_delta`, applied when a message expires unanswered. The UI owns the real-time `expires_s` timer and shows one message at a time, never during the tutorial, a page, or an open minigame.

`npm run validate` rejects a trigger naming an unknown metric and a message whose every response costs reputation — a message the player cannot answer well is a trap, not a decision.

**The pager** (`src/ui/components/organisms/PagerOverlay.tsx`) is UI-only: an incident of severity ≥ 4 arriving outside the tutorial raises a full-screen page with the **level-0** signal text only (§13 — a page never carries diagnostics), a 15 s ACK window, and the arrival tone. The clock keeps running. The incident card then shows `acked in Ns` or `page unacknowledged`.
