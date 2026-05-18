# Challenge 003: Reproduce the baseline

**Goal:** reproduce the 522× headline number on your own machine and post the receipt.

## What you'll need

- A working Pi/pim install (`pi --version` should print a number)
- An Anthropic API key (or any provider Pi supports; the headline used `claude-opus-4-7`)
- ~$0.02 of API budget per run

## Steps

```bash
# 1. Fresh tmp dir
mkdir /tmp/pi-precog-repro && cd /tmp/pi-precog-repro
git init

# 2. The fixture
cat > package.json <<'EOF'
{ "name": "repro", "scripts": { "test": "node test.js" } }
EOF
cat > test.js <<'EOF'
await new Promise(r => setTimeout(r, 15_000));
console.log("ok");
EOF
git add -A && git -c user.email=t@t -c user.name=t commit -m init

# 3. Install pi-precognition
npm install pi-precognition --no-save
pi install -l node_modules/pi-precognition

# 4. Baseline: pim WITHOUT precog
PI_PRECOG=0 pim -p "Run npm test and summarize the output." \
  --mode json --no-session > /tmp/baseline.txt 2>&1

# 5. Warmed: pim WITH precog and a generous draft prime
PI_PRECOG=1 PI_PRECOG_TOOL_CACHE=1 PI_PRECOG_COMMAND_FUTURES=1 \
  PI_PRECOG_PRIME_DRAFT="Run npm test and summarize the output." \
  PI_PRECOG_PRIME_BUDGET_MS=17000 \
  PI_PRECOG_COMMAND_TIMEOUT_MS=25000 \
  pim -p "Run npm test and summarize the output." \
  --mode json --no-session > /tmp/warmed.txt 2>&1
```

## Capture the receipt

Look for a `tool_cache_hit` log entry (will be in `$PI_PRECOG_LOG` if you set it, or in stderr if you have a UI extension that writes it).

The expected behavior:

```
baseline.txt: model waits ~15s for npm test, total run ~22s
warmed.txt:   model waits ~30ms for npm test, total run ~7s
```

## Submit the row

Open a PR adding to `challenges/leaderboard.md`:

```markdown
| Workload | Contributor | Baseline | Warmed | Speedup | Machine | Date |
|---|---|---:|---:|---:|---|---|
| slow-command (15s) | your-handle | 21.9s | 6.6s | 3.3× | M1 Max, 32GB | 2026-XX-XX |
```

Attach the two `.txt` outputs to the PR description so the row is verifiable.

## What if you can't reproduce 3.3×?

You won't always. The variance sources are:

- **Network RTT to Anthropic** — first-token TTFT swings 300-2000ms
- **Provider load** — Anthropic's queue depth fluctuates hour-to-hour
- **Your machine's clock** — `setTimeout(15_000)` is wall-clock, but model TTFT isn't

The signal is the **paired delta** between baseline and warmed on the same fixture in the same window. A 2× improvement is a successful repro. A 5× improvement is the upper bound. We've never measured worse than 1.5× when the draft budget is set correctly.

If you measure a regression (warmed slower than baseline), open an issue — that's interesting data we want.
