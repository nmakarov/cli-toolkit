# Changelog

All notable changes to this project will be documented in this file.

## [0.2.0] - 2025-11-09

### Added
- **MockServer module** - HTTP mock server with FileDatabase integration for API testing
  - Express.js server with request/response capture and replay
  - Intelligent request matching with operation ID support
  - Configurable sensitive data masking (authorization, API keys, etc.)
  - Automatic catalog management and maintenance cleanup
  - Test server redirection support for HttpClient integration
- **HttpClient module** - Resilient HTTP client with automatic retry, error classification, and unified responses
  - Exponential backoff with jitter to prevent thundering herd problems
  - Human-readable error names (connectionFailed, timeout, unauthorized) instead of technical codes
  - Support for all HTTP methods (GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS)
  - Never-throws API with unified response format
  - Comprehensive logging and per-request configuration overrides
- **FileDatabase module** - Versioned/non-versioned file storage with chunking and pagination
  - Versioned mode for data history, non-versioned mode for single objects
  - Automatic legacy format detection and metadata generation
  - Optimized metadata building (reads only first/last files for JSON arrays)
  - Custom synopsis functions for data analysis
  - 100% backward compatibility with existing data structures
- **HttpClient and FileDatabase examples** integrated into interactive example runner
- **Comprehensive CI test suites** for new modules with **311 total tests** and **80%+ code coverage**
  - HttpClient: 60 tests, 80%+ coverage across errors.ts (91%), index.ts (84%), retry.ts (100%)
  - FileDatabase: 26 tests, 80%+ coverage across all files
  - MockServer: 63 tests, 80%+ coverage across catalog.ts (85%), index.ts (65%), sanitization.ts (97%)
- **Axios dependency** (^1.6.0) for HttpClient HTTP functionality

### Changed
- Updated README.md with HttpClient and FileDatabase documentation and examples
- Updated PROMPT.md with new implementation patterns and gotchas
- Enhanced example runner to include HttpClient and FileDatabase demos
- Updated package.json exports and build configuration for new modules

### Technical Details
- HttpClient uses axios as battle-tested HTTP foundation with enhanced error handling
- FileDatabase supports both timestamped versioning and direct file storage
- Both modules follow "never throw" pattern for predictable error handling
- Comprehensive TypeScript types and human-readable error classifications

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


