# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

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


