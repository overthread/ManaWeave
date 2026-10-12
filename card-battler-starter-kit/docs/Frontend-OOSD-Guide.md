# Frontend OOSD Guide

This project keeps frontend gameplay UI in feature-focused modules with one composition root.

## Layering for Public UI Modules

- Composition layer:
  - Owns wiring and dependency injection.
  - Example: game-view.js creates controllers and coordinates render flow.
- Feature controller layer:
  - Owns one interaction workflow per file.
  - Examples: context menu, analyze panel, discard inspector, play selection.
- Pure render/helper layer:
  - Stateless mapping and render utilities.
  - Examples: phase glow mapping, score pile rendering, move-action key helpers.

## Responsibilities

- game-view.js
  - Orchestrates legal actions, command mode transitions, and high-level render sequence.
  - Does not contain long DOM workflow blocks for feature-specific behavior.
- game-view-*.js modules
  - Hold isolated behavior that can be changed independently.
  - Receive dependencies through arguments instead of importing game state directly.

## Design Rules

- Keep each controller focused on one capability.
- Pass dependencies in through factory functions.
- Keep transport/network calls at orchestration boundaries.
- Keep helper modules side-effect free when possible.
- Preserve existing UI contract and element IDs/classes during refactors.

## Refactor Checklist

- Does each file have a single reason to change?
- Can a workflow be tested by mocking dependencies?
- Are cross-module calls explicit through injected callbacks?
- Is the composition root still the only place that knows all modules?
