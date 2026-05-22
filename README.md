# pi-context-whisperer 🦜

Smart gradual auto-compaction for Pi — warns you and auto-compacts before context limits hit, preserving your flow.

## How it works

Context Whisperer monitors your context window usage after every turn and takes action before you hit limits:

```
Context: 45% → 🦜 ███████░░░ 58k/128k ✓ Healthy
Context: 72% → 🦜 █████████░░ 92k/128k ⚡ Warning    (notifies you)
Context: 82% → 🦜 ██████████░ 105k/128k ⚠ COMPACT NOW (auto-compacts)
Context: 35% → 🦜 █████░░░░░ 45k/128k ✓ Healthy     (freed up!)
```

## Features

- **Context health bar** — live in footer: ████░░░░ with percentage
- **Warning at customizable threshold** — nudges you when context gets tight
- **Auto-compaction** — automatically compacts at critical threshold so you don't crash
- **Prevents wasted calls** — no more "context limit exceeded" mid-task
- **Compaction counter** — see how many times it's saved you this session
- **Fully configurable** — set your own warn/auto thresholds

## Install

```bash
# npm
pi install npm:pi-context-whisperer

# GitHub
pi install git:github.com/Jaraxxxx/pi-context-whisperer
```

## Commands

| Command | Description |
|---------|-------------|
| `/whisper-enable` | Turn on auto-compaction |
| `/whisper-disable` | Turn off (manual `/compact` only) |
| `/whisper-stats` | Show current stats and thresholds |
| `/whisper-config 60 80` | Set warn at 60%, auto at 80% |
| `Ctrl+Shift+C` | Force compact now |

## LLM Tools

The `context_health` tool lets the agent check context status before making large requests.

## Default thresholds

| Threshold | Default | Behavior |
|-----------|---------|----------|
| Warn | 70% | Notification only |
| Auto-compact | 80% | Triggers compaction automatically |

Change with: `/whisper-config <warnPct> <autoPct>`

## Requirements

- Pi coding agent
- Auto-compaction enabled in settings (default: on)