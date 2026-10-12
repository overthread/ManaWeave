# Card Battler Starter Kit

Everything needed to build a NEW online deckbuilding card battler from scratch, using the architecture proven in GMC TCG Battlesim.

## Contents

- `skills/card-battler-sim/` — the ZCode skill (`SKILL.md` + `references/`) with the full build workflow, copy-ready code blueprints, protocol/data specs, and ruleset-authoring/hardening guides.
- `docs/` — the reference docs:
  - `Online-Deckbuilder-Sim-Guide.md` — end-to-end architecture reference (start here)
  - `Ruleset-Integration-Guide.md` — how to write YOUR game's ruleset
  - `Frontend-OOSD-Guide.md` — browser UI layering conventions
  - `OOSD-Architecture.md` — layering and design patterns

## How to use in a new project

1. Copy `skills/card-battler-sim/` into the new project at `.agents/skills/card-battler-sim/` (or `~/.agents/skills/` to keep it available everywhere).
2. Optionally copy `docs/` into the new repo for reference.
3. Start a ZCode session and describe the game you want ("build an online 2-player card battler where ..."), or invoke the skill directly with `/card-battler-sim <your rules>`. The skill drives the whole build: scaffold → domain → engine → transport → lobby → deckbuilder → UI → your ruleset → hardening.

Tip: bring a one-page rules summary and/or a card spreadsheet — the skill ingests cards from published CSVs (Google Sheets), so balancing stays code-free.
