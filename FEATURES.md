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

## HttpClient Module
- ✅ Core HttpClient class with axios wrapper and unified response format
  - Challenges: ensuring never-throws behavior while maintaining proper error classification and logging.
- ✅ Progressive retry logic with exponential backoff and jitter
  - Challenges: preventing thundering herd problems with randomized delays while maintaining predictable test behavior.
- ✅ Human-readable error classification (connectionFailed vs ECONNRESET)
  - Challenges: mapping technical network errors to use-case oriented names while preserving debugging information.
- ✅ Support for all HTTP methods (GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS)
  - Challenges: maintaining consistent behavior across methods while handling method-specific request formatting.
- ✅ Comprehensive CI tests with axios mocking (60 tests, 80%+ coverage across all files)
  - Challenges: mocking complex axios behavior while ensuring realistic error scenarios and retry logic validation.
- ✅ Interactive examples demonstrating error handling and retry scenarios
  - Challenges: creating realistic network failure scenarios for demonstration without external dependencies.

## FileDatabase Module
- ✅ Versioned/non-versioned storage modes with automatic format detection
  - Challenges: maintaining backward compatibility with legacy data structures while adding new metadata features.
- ✅ Chunked file writes and pagination for large datasets
  - Challenges: optimizing metadata building by reading only first/last files for JSON arrays.
- ✅ Legacy format compatibility and automatic metadata generation
  - Challenges: detecting data types and building metadata on-the-fly without explicit configuration.
- ✅ Custom synopsis functions for data analysis and statistics
  - Challenges: providing flexible calculation framework while maintaining performance for large datasets.
- ✅ Custom metadata support with `findData()` method
  - Added `customMetadata` option to `WriteOptions` for storing arbitrary metadata fields
  - Custom metadata fields stored directly in FileEntry objects for efficient searching
  - `findData(searchCriteria)` method searches files by custom metadata across versions
  - Intelligent file creation/overwriting based on custom metadata matching
  - Challenges: ensuring correct file numbering, maintaining search performance, handling metadata updates.
- ✅ Comprehensive CI tests covering all storage modes and edge cases (26 tests, 80%+ coverage)
  - Challenges: testing file system operations and ensuring proper cleanup between test runs.
- ✅ Interactive examples with data inspection and format detection
  - Challenges: creating sample datasets that demonstrate real-world usage patterns and performance characteristics.

## DB Module
- ✅ Complete refactoring following consistent init pattern
  - `dbInit(context, dbNameOrConnectionString?)` function that auto-connects to databases
  - `dbFindAndConnect(context, dbNameOrConnectionString?)` for database name resolution
  - `dbConnect(context, connectionString, name?, dbProfile?)` dedicated connect function
  - Database name resolution: `dbName` → `dbConnectionString${CapitalizedName}`
  - Supports direct connection strings (postgresql:// or mysql://) or database name labels
  - Auto-connects, tests connection, and registers cleanup functions
  - Better error handling with dedicated connect function
  - Challenges: maintaining backward compatibility while introducing new patterns, ensuring consistent API design.

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
- ✅ NPM package publication with automated release scripts
  - Challenges: dual ESM/CJS support required chalk downgrade from v5 to v4; missing logger export caused CommonJS import failures; coordinating git tags, version bumps, and npm publish in single command.
- 📝 Dependency cleanup: remove `@types/joi` (Joi provides its own types), address `source-map` deprecation warning
  - Challenges: ensuring type definitions work correctly after removing @types/joi, verifying no build issues from source-map update.

## Time/Date Handling
- ✅ ISO8601 internal representation (UTC strings like `2025-01-01T01:01:01Z`)
  - Challenges: changing return type from Date to string required updating all tests and examples; ensuring timezone-aware parsing.
- ✅ Cross-parameter references with `@paramName+offset` syntax for calculated timestamps
  - Challenges: maintaining evaluation order, passing Joi context through validation chain, error handling for missing/invalid references.
- ✅ Time params playground example with multiple display formats (ISO, date-only, human-readable, PST conversion)
  - Challenges: balancing simplicity with timezone complexity without external libraries.
- 📝 Comprehensive timezone support with named zones (PST, EST, etc.) and DST handling
  - Challenges: deciding whether to use luxon/date-fns-tz vs native APIs, maintaining small bundle size.

### MockServer Module

**Status:** ✅ Complete (0.2.0)

**Core Components:**
- **Express Server**: Full Express.js HTTP server with configurable middleware
- **Request Matching**: Intelligent matching using FileDatabase catalog with operation ID support
- **Data Sanitization**: Configurable masking of sensitive data (auth tokens, API keys, passwords)
- **Catalog Management**: Automatic catalog creation, maintenance, and cleanup
- **FileDatabase Integration**: Uses FileDatabase for persistent mock storage and retrieval

**Key Features:**
- **HTTP Server**: Express.js based with standard endpoints (/version, /404, /test)
- **Mock Capture**: Store API responses with metadata for later replay
- **Request Matching**: Exact and fuzzy matching with operation ID precision
- **Sensitive Data**: MD5-hashed masking of configurable sensitive fields
- **Maintenance**: Automatic cleanup of orphaned files and invalid catalog entries
- **HttpClient Integration**: Test server redirection for seamless testing

**Test Coverage:** 63 tests, 80%+ coverage across catalog.ts (85%), index.ts (65%), sanitization.ts (97%)

**Challenges Solved:**
- **Legacy Migration**: Replacing MockEngine.js with modern, type-safe implementation
- **Catalog Queries**: Efficient request matching using FileDatabase as storage backend
- **Sensitive Data Handling**: Balancing security (masking) with functionality (matching)
- **Server Management**: Proper Express server lifecycle and error handling
- **Test Integration**: Seamless integration with HttpClient for development workflows

**API Surface:**
- `MockServer` class with start/stop/server management
- `storeMock()` - Capture and store responses
- `listMocks()` - Query stored responses
- `removeMock()` - Delete specific mocks
- `maintenance()` - Clean up orphaned data
- `createMockServer()` convenience function

