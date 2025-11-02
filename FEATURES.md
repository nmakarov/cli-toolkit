# Feature Tracker

This document captures planned and delivered functionality inferred from ongoing development discussions. Entries are grouped by component and marked with their status.

Legend:
- ✅ = complete
- 🚧 = in progress / partially complete
- 📝 = planned / not started

## Logger
- ✅ Console fallback logger (basic debug/warn/error wrapper for init bootstrap)
  - Challenges: keep dependency footprint tiny so it can run even when Params/context aren't ready.
- ✅ Full CLI logger module (levels, JSON/text, IPC routing, progress throttling)
  - Challenges: balancing rich formatting with IPC-friendly JSON payloads; aligning progress throttling semantics with legacy behaviour.
- ✅ Logger CI tests (transport selection, level filters, throttle behaviour, formatting)
  - Challenges: mocking `process.send` safely inside Vitest workers; asserting coloured output without relying on ANSI codes.
- ✅ Sample scripts demonstrating logger usage (stand-alone + init-integrated)
  - Challenges: show both console and IPC routes while remaining runnable in any terminal.
- ✅ Logger demos integrated into interactive example runner
  - Challenges: ensuring logger examples run correctly when spawned from the launcher.

## Screen System
- ✅ CI coverage for screen utilities (key binding formatting, showScreen flow, list helpers)
- ✅ Additional coverage for components/ui-elements/list-components/footer builder (expand tests)
  - Challenges: React/Ink components rely on hooks and layout calculations; needed enhanced mocking for createElement, isValidElement, and children propagation to achieve ~86% coverage without full Ink rendering.

## Args Module
- ✅ CI tests for precedence, config/dotenv loading, alias resolution, singleton helpers
  - Challenges: orchestrating real temp files (.env, .js, .json) to hit every precedence branch without polluting the repo.

## Params Module
- ✅ CI tests for getters/setters, Joi conversions, custom types, singleton helpers
  - Challenges: covering custom Joi helpers and ensuring array/string coercions throw when expected.
- 📝 Cross-parameter references with `@` syntax (e.g., `@startTime+2h`) for calculated values
  - Challenges: maintaining left-to-right evaluation order, type validation of referenced params, error handling for missing/invalid references, extensibility to other types beyond dates.
- 📝 Date/time utility library with timezone conversions and multiple output formats
  - Challenges: balancing simplicity with timezone complexity, deciding when to use external libraries (luxon/date-fns-tz) vs native Date APIs.

## Error Classes
- ✅ CI test for inheritance/name wiring of custom errors
  - Challenges: minimal, mostly verifying prototype chains.

## Documentation & Tooling
- ✅ Changelog entries for CI coverage additions and example runner updates
- ✅ README/Quick Reference updates for new test scripts and example launcher
- ✅ Logger documentation updates
  - Challenges: keep docs synchronised with rapidly evolving scripts and commands.
- ✅ Example folder reorganization (config/env files moved to component subdirectories)
  - Challenges: updating all path references in example scripts and documentation.
- 📝 Dependency cleanup: remove `@types/joi` (Joi provides its own types), address `source-map` deprecation warning
  - Challenges: ensuring type definitions work correctly after removing @types/joi, verifying no build issues from source-map update.


