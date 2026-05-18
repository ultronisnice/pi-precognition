# Slow command example

The workload behind the headline `15.2s → 29ms` number.

## Setup

```bash
cd examples/slow-command
npm install
```

The fixture is a tiny project with a 15-second `npm test`:

```js
// test.js
await new Promise((r) => setTimeout(r, 15_000));
console.log("ok");
```

## Run

```bash
# Cold baseline — what users feel without precognition
time npm test
# → ~15s

# Warmed — what users feel WITH precognition (in an actual pim session)
# 1. Operator types: "run npm test" (takes 5-15s of typing time)
# 2. Precognition warms the npm test future in background during typing
# 3. Operator hits enter
# 4. Model calls bash("npm test")
# 5. Cache hits — returns in ~30ms (or whatever your PI_PRECOG_CACHE_DELAY_BASH_MS is set to)
```

## Why this number is real

This workload is **the upper bound** on precognition's value, not the typical case. It requires:

1. A long-running tool (≥ several seconds)
2. A long-enough draft window (operator typing time ≥ tool runtime)
3. Causal stability (no file changes between warm and serve)

When all three hold, you get the 500× collapse. When they don't, you get something between 1× (analytical turn, no benefit) and 5× (sub-second tool warmed during a typical 2-3s draft).

The benchmarks doc (`docs/benchmarks.md`) breaks down what each workload class actually produces.

## Reproducing the artifact

The validated n=3 paired live result is checked into `validation/precog_live_ab_2026-05-15T05-57-56-215Z.md`. To reproduce on your machine you need:

- A working Pi/pim install (`pi --version`)
- Anthropic API key (or override the provider via `PI_PROVIDER`)
- The bench harness — bundled in v0.3 as `pi-precognition bench`; currently lives in the upstream lab

Until v0.3 ships, this folder serves as the cleanest manual reproduction path.
