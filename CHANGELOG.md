# Changelog

All notable changes to this project will be documented in this file.

## [0.1.2] - 2025-11-02

### Added
- Logger module export to `package.json` and `tsup.config.ts` for proper CommonJS/ESM distribution.
- Cross-parameter reference support in `date` type using `@paramName+offset` syntax (e.g., `@startDate+2h`).
- `time-params-playground.ts` example demonstrating ISO8601 timestamps, timezone conversions, and cross-parameter calculations.
- Date utility library (`src/utils/date-utils.ts`) with formatting and timezone conversion helpers.
- Automated release scripts: `release:patch`, `release:minor`, `release:major` for streamlined publishing.

### Changed
- `joiEdateType` now returns UTC ISO8601 strings (`YYYY-MM-DDTHH:mm:ssZ`) instead of Date objects for consistent internal representation.
- Downgraded `chalk` from v5 to v4.1.2 for CommonJS compatibility in dual-module builds.
- Params `validate()` method now passes current params as Joi context to enable cross-parameter references.
- Params `getAll()` stores validated values during left-to-right processing to support `@` references.
- Split `show-params.ts` into two examples: `show-params.ts` (no defaults) and `show-params-defaults.ts` (with defaults).

### Fixed
- Logger module not building for CommonJS consumers due to missing export configuration.
- Params CI tests updated to expect ISO8601 strings instead of Date objects for `date` type.

## [0.1.1] - 2025-11-02

### Added
- Central interactive launcher available via `npx tsx examples/example-runner.ts`, grouping Args, Params, Screen, and Logger demos with multiple variants.
- Component-local test suites under `src/<component>/tests/` with dedicated `*.ci.test.ts` smoke checks.
- Extensive CI coverage for Args, Params, and error classes to verify precedence, validation, and inheritance paths.
- Logger module (fallback bootstrap, full-featured logger with text/JSON modes, progress throttling, console/IPC transports, CI tests, usage examples) with ~89% coverage.
- Expanded Screen CI tests now covering utils, footer builder, UI elements, list components, and multi-column previews (~86% coverage).

### Changed
- Updated documentation to cover the new example runner, testing commands, and test layout.
- Adjusted example runner execution strategy to pass whole command strings when using `shell: true`, avoiding Node.js deprecation warnings.
- Reorganized `examples/` folder: moved config and env files into `examples/args/` to reduce clutter.

### Fixed
- Prevented Ink "raw mode" errors when executing interactive examples from the launcher by delegating those commands directly to the terminal.
- React key warnings in `ScreenFooter` and `ListComponent` by ensuring all child elements have unique, dynamic keys.
- Logger test assertions adjusted for ANSI-colored output and fake timer behaviour.


