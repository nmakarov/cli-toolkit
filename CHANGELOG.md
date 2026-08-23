# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Fixed
- **Logger.progress rate/ETA**: rate is now `(count - countAtFirstSample) / elapsed`
  instead of `(count - 1) / elapsed`. Batched reporters (e.g. loader every N
  records) no longer show inflated early `/s` because the clock started on the
  first print while the numerator still assumed progress from item 1. First
  sample still shows `-/s`; from the second sample onward the rate matches
  steady throughput.

### Added
- **Screen footer hotkeys**: `formatKeyBindings` / `showScreen` render each
  key label (`esc`, `←`, `enter`, `r`, `↑`, `↓`, …) as its own bold bright
  white span so they stand out from the dim "to …" captions. Scripts only
  define bindings; highlighting is automatic.
- **Esc goes back**: Ink's `useInput` always sets `meta: true` on Escape
  (Escape is the terminal meta prefix). `bindingMatchesInput` no longer
  treats that as Option+Esc, so the default `esc` + `←` "go back" bindings
  both fire.
- **Params.reportResolved(key, value, source?, module?)**: components that
  resolve values on their own (e.g. by merging their config files, the way
  blueprints do) can report what they actually discovered, so the
  `--showUsedParams` dump shows real values instead of `undefined (default)`.
  Entries figured from explicit inputs (cli/env/options) are never overridden;
  unseen keys are appended under the given module. The LATEST report wins, and
  a later params.get() probe that finds nothing ("default") never shadows a
  reported value in the dump — components typically re-probe for overrides on
  every resolution cycle, and those misses say nothing about the value in use.
  (Fixes the 0.36.0 behavior, where "first report wins" let a later
  resolution cycle's empty probes shadow reported values, showing
  `undefined (default)` again.)
- **Declarative DDL ensure (db/ensure.js)**: `ensureSchema(db, spec)` /
  `ensureSchemaEverywhere(dbs, spec)` (plus `ensureTable`, `ensureIndex`,
  `ensureExtension`) — components describe tables/columns/indexes/extensions
  as a spec; the helpers diff it against a live database and apply only what's
  missing (create table, ADD COLUMN, CREATE INDEX IF NOT EXISTS; never drops).
  All support `dryRun`. Being data-driven, the same spec can be applied to any
  number of databases.
- **Db.discoverSiblings(context, { prefix | match })**: enumerate the sibling
  databases currently in use — same-server scan of `pg_database` merged with
  env-declared ones (`DB_CONNECTION_STRING_SIB_<NAME>` vars, a dedicated
  namespace which also covers siblings that moved to their own server).
  **Db.initAllSiblings** discovers and connects them all
  (`includeMain: true` prepends `context.db`).
- **ensureTaskTables rewritten (spec-driven, multi-database)**: the three queue
  tables are now declared via `tasksSchemaSpec(queueName)` and applied through
  `ensureSchema`, so an older installation gets missing COLUMNS added, not
  just missing tables. New `databases: [handles]` option applies the ensure to
  every given database (e.g. from `Db.initAllSiblings`). `recreate` / `dryRun`
  behave as before.
- **Db.initSibling(context, name, options?)**: sibling-database handlers — same
  server/credentials as a base database, different database name. Resolution:
  explicit `dbConnectionStringSib<SiblingName>` param (env
  `DB_CONNECTION_STRING_SIB_<SIBLING_NAME>`) wins and also declares the
  sibling; otherwise derived from `options.baseDb` /
  `options.baseConnectionString` / `context.db` by swapping the database name.
  Location-agnostic fallbacks: an empty name, or a sibling database that does
  not exist on the base server (not migrated yet), return the MAIN handler —
  call sites never need to know what has been split where. Handlers are cached
  per name on `context.siblingDbs` (one pool per sibling, fallback answers
  included) and disconnect via `registerCleanup`. Also exports
  `replaceDatabaseName(connectionString, dbName)`.
- **DB Module Refactoring**: Complete architectural refactoring following consistent init pattern
  - Added `dbInit(context, dbNameOrConnectionString?)` function that auto-connects to databases
  - Added `dbFindAndConnect(context, dbNameOrConnectionString?)` for database name resolution
  - Added `dbConnect(context, connectionString, name?, dbProfile?)` dedicated connect function
  - Database name resolution: `dbName` → `dbConnectionString${CapitalizedName}` (e.g., "local" → `dbConnectionStringLocal`)
  - Supports direct connection strings (postgresql:// or mysql://) or database name labels
  - Auto-connects, tests connection, and registers cleanup functions
  - Better error handling with dedicated connect function
- **FileDatabase Custom Metadata Support**: Enhanced FileDatabase with custom metadata capabilities
  - Added `customMetadata` option to `WriteOptions` interface
  - Custom metadata fields stored directly in FileEntry objects
  - Added `findData(searchCriteria)` method to search files by custom metadata fields
  - Supports searching across all versions and files
  - Returns file paths, metadata, and data for found entries
- **FileDatabase Write Logic Fixes**: Improved file creation and overwriting behavior
  - When customMetadata provided, searches existing files for matching keys/values
  - If exact match found, overwrites existing file; if no match, creates new file
  - Ensures each unique customMetadata combination gets its own file
  - Fixed file numbering initialization from existing metadata
- **FileDatabase Init Pattern**: Added `fileDatabaseInit()` function following the same pattern as `MlsClient.init`
  - Accepts `Context` as first parameter for consistent initialization pattern
  - Reads configuration from `context.params` with sensible defaults (basePath: "./data", namespace: "default", pageSize: 5000, maxVersions: 5)
  - Allows options parameter to override params values
  - Maintains full backward compatibility with legacy config object pattern
  - Enables early validation and fail-fast behavior during initialization
- **Args Environment Variable Alternative Format Support**: Enhanced `Args.get()` to support alternative environment variable name formats
  - Automatically tries alternative format by removing underscores before numbers (e.g., `TRESTLE_IDXPLUS_2_ID` -> `TRESTLE_IDXPLUS2_ID`)
  - Handles cases where env var names don't follow standard camelCase->SNAKE_CASE conversion
  - Falls back to alternative format only if exact match is not found
  - Maintains backward compatibility with standard naming conventions

### Fixed
- **Test Output Suppression**: Suppressed debug output in all CI tests for cleaner test runs
  - FileDatabase tests now use silent logger instances
  - MockServer tests now use silent logger instances
  - Init tests now use `silent: true` option
  - Logger tests now mock console methods to suppress output while maintaining test assertions
  - All tests pass with clean output, no debug messages appearing in test results

### Changed
- **Code Cleanup**: Removed old and refactored backup files
  - Deleted `index-old.ts` files from init, logger, and params modules
  - Deleted `index-refactored.ts` file from logger module
  - Cleaned up associated coverage HTML files

### Added
- **Screen Module CommonJS Support**: Added `load()` function to enable CommonJS usage with ESM-only dependencies (`ink`, `react`)
  - Post-build script (`scripts/fix-cjs-esm-deps.js`) transforms CJS builds to use dynamic imports
  - CommonJS users must call `await screen.load()` before using the module
  - ESM users are unaffected and can use `import` normally
  - See [Screen Module Documentation](docs/SCREEN.md#module-system-support) for details
- **Init Function Enhancement**: `init` function now automatically loads ESM dependencies for screen module
  - Eliminates need for manual `load()` calls in top-level scripts
  - Simplifies CommonJS usage patterns
  - Internal async module loading handles screen-related dependencies

### Fixed
- **Logger Test Environment**: Fixed logger to avoid `process.send()` interference in Vitest test environments
  - Added environment detection to prevent IPC mode in test contexts
  - Logger now checks for `process.env.VITEST` or `process.env.NODE_ENV === "test"`
  - Prevents unhandled errors during test runs

### Changed
- **Documentation Updates**: 
  - Added CommonJS usage patterns to README.md, SCREEN.md, and QUICK_REFERENCE.md
  - Documented ESM-only dependency limitations and workarounds
  - Updated examples to show both ESM and CommonJS usage
  - Simplified example scripts to use new init function pattern

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


