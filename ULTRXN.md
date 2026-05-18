# ULTRXN

Validated futures for agent systems.

The diff is the answer.

---

## Thesis

Agents do not become infinite by remembering everything.
They become infinite by compiling experience into runtime policy.

The loop:

```
signal → future → validation → receipt → Mirror → policy → better future
```

The Mirror is the part that was missing in v0.2.

## v0.3 — Reforge is live

Reforge is the recursive compiler at the core of the ULTRXN Runtime.
It reads receipts — pattern libraries, paired-bench reports, mutation
streams — folds them into a **Mirror** of the operator, and **compiles
a new runtime policy** the anticipation planner consumes on the next
turn.

The compiler is idempotent given the same Mirror inputs. Each generation
is an improvement candidate backed by the receipt that justified it; no
improvement, no generation. Identical re-runs do not bump the lineage.
Honest bench regressions correctly prevent policy evolution.

What this means in practice:

```
gen 0  →  hardcoded planner defaults (the v0.2 baseline)
gen 1  →  Mirror starts seeing the operator across projects
gen 2…N  →  policy moves only when receipts justify the move
```

The recursion is closed because the planner now reads the compiled
policy in its hot path: pinned refs always boost, rhythm boosts inject
intent tags so command futures fire even when the draft doesn't
explicitly mention the verb, per-tool `armThresholdMs` lowers for
profitable tools, and broad knobs widen only with strong evidence.

## First artifact

`pi-precognition` v0.3 — draft-time validated futures plus a recursive
compiler that turns operator receipts into evolving policy.

Predict the wait, not the answer. Learn the operator rhythm. Compile
experience into policy.

## Rules

- Receipts over claims.
- Validation before serve.
- No mutating speculation.
- No hidden context by default.
- A future is only worth warming when expected saved wait exceeds expected cost.
- The Mirror is always inspectable. The policy is always inspectable.
  Lineage is append-only. History is immutable.

## Runtime chain

```
pi-precognition  →  draft-time futures + Reforge recursive compiler   [v0.3 live]
pi-cascade       →  intra-turn future chains
pi-lattice       →  bounded future graphs
pi-pruner        →  expected-value governance
pi-epochs        →  experience compiled into policy (subsumed into Reforge)
ULTRXN Runtime   →  agents that wait less the longer they run
```

v0.3 collapses what was once the `pi-epochs` proposal into the same
package as the draft-time futures. The recursive compiler and the JIT
planner share a process and the receipt loop is closed in one repo.

## Identity

```
ULTRXN builds validated futures for agent systems.
pi-precognition predicts the wait, not the answer.
Reforge compiles the operator into the policy.
Build a future. Submit a receipt. Bump the generation.
The longer it runs, the less it waits.
```

## v0.4 — Substrate Night

Reforge stopped being one compiler. It became a substrate of three
organs.

```
signal → future → validation → receipt → Mirror → policy → better future
                                                  ↓
                                              Rulekraft
                                              /        \
                                       planner.*    runtime.*
                                          ↓             ↓
                                       planner    RuntimeBrief → agent
                                          ↑                            |
                                          └──── Shadow (counterfactual)┘
```

Three additions, designed across a dialectic between an Opus architect
(*one deep organ, fuse policy DSL with the runtime brief*) and an
isolated Adversary (*don't ship organs on 835ms of evidence; build the
A/B rig first; the runtime brief is the horoscope trap*). Both were
right about different things. v0.4 is the synthesis.

### Shadow — the A/B counterfactual rig

Every shadow-enabled `planAnticipation` call computes a baseline plan
against the seed-default policy and logs the divergence to JSONL.
Without this meter, *"Reforge saved 835ms"* is unfalsifiable. With it,
every plan call is a free counterfactual datum. The Mirror finally has
a way to ask itself: *was that move a real lift, or noise?*

### Rulekraft — PolicyDSL with honesty gates

Policy moves from a flat parameter struct to a small rule program. A
rule has a `Predicate` precondition and an `Action[]` consequent. Two
action vocabularies share the same rule engine:

- `planner.*` — steers the existing anticipation planner.
- `runtime.*` — steers the agent's own per-turn behavior.

The honesty discipline is the design's core. Every compiled rule carries
**provenance** linking back to the Mirror counters that justified it. If
the compiler cannot point at the receipt, the rule does not compile.
The first generation (gen-6) produced **zero** compiled rules — the
live Mirror failed the precondition gates, and the compiler refused to
manufacture rules from insufficient signal. *That refusal is the
substrate working as designed.*

### RuntimeBrief — closes the path Mirror → agent

The Mirror-compiled artifact that finally steers ULTRON's own routing,
verbosity, and tool-bias — not just the planner's warming. Narrow and
falsifiable by construction:

- The brief is allowed to be silent. Silence is the correct receipt
  when no `runtime.*` action fires.
- Every line cites the rule id that produced it. Audit by name.
- An anti-horoscope test rejects any output that paraphrases static
  preferences. *"the operator likes glyphs"* is barred by regex.

### Recursion now closes through the agent

```
operator turn → pattern lib → Mirror → Rulekraft compile → planner steer
                                  ↓                            ↓
                          runtime brief ────────────► ULTRON next turn
                                  ↑                            |
                                  └──── Shadow ←───────────────┘
                                        (counterfactual)
```

The loop now closes in two places: the planner (since v0.3) and the
agent's own behavior (new in v0.4). The Shadow rig produces the
counterfactual data that makes the next move auditable. The longer it
runs, the less it waits AND the better its model of how to operate.

## Honest negative

v0.4 ships the substrate. Gen-6 had zero compiled rules. The cumulative
savedMs is still 835ms — exactly v0.3's number, because no new bench
data was folded. The system did not get faster tonight. It got *more
honest about its own limits* tonight. The lift accumulates as
`PI_PRECOG_SHADOW=1` and `PI_PRECOG_BRIEF=1` sessions add real
counterfactual data over the next week.

This is what *industry-shaking* actually looks like when receipts are
mandatory: not a cathedral hung in air, but the meter that catches
cathedrals hung in air. The substrate is the leap. The signal will
follow.

## Runtime chain — updated

```
pi-precognition v0.4  →  draft-time futures + Reforge substrate
                         (Shadow · Rulekraft · RuntimeBrief)            [LIVE]
pi-cascade            →  intra-turn future chains
pi-lattice            →  bounded future graphs
pi-pruner             →  expected-value governance
pi-epochs             →  subsumed into Reforge (since v0.3)
pi-runtime-brief      →  subsumed into Reforge (since v0.4)
ULTRXN Runtime        →  agents that wait less the longer they run,
                          and operate better the more they observe
```
