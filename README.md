# @nmakarov/cli-toolkit

A comprehensive TypeScript toolkit for building professional CLI applications with argument parsing, parameter validation, interactive terminal UIs, and structured logging.

[![npm version](https://img.shields.io/npm/v/@nmakarov/cli-toolkit.svg)](https://www.npmjs.com/package/@nmakarov/cli-toolkit)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![CI](https://github.com/nmakarov/cli-toolkit/workflows/CI/badge.svg)](https://github.com/nmakarov/cli-toolkit/actions)
[![codecov](https://codecov.io/gh/nmakarov/cli-toolkit/branch/main/graph/badge.svg)](https://codecov.io/gh/nmakarov/cli-toolkit)
[![Known Vulnerabilities](https://snyk.io/test/github/nmakarov/cli-toolkit/badge.svg)](https://snyk.io/test/github/nmakarov/cli-toolkit)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![Node Version](https://img.shields.io/node/v/@nmakarov/cli-toolkit.svg)](https://nodejs.org)
[![npm downloads](https://img.shields.io/npm/dm/@nmakarov/cli-toolkit.svg)](https://www.npmjs.com/package/@nmakarov/cli-toolkit)
[![Bundle Size](https://img.shields.io/bundlephobia/minzip/@nmakarov/cli-toolkit)](https://bundlephobia.com/package/@nmakarov/cli-toolkit)

## Features

- 🎯 **Args** - Powerful argument parser with config files, environment variables, and precedence rules
- ✅ **Params** - Type-safe parameter validation with Joi schemas and cross-parameter references
- 🖥️ **Screen** - Interactive terminal UIs with React/Ink (lists, menus, grids, navigation)
- 📝 **Logger** - Structured logging with levels, progress tracking, and IPC routing
- ⚡ **Errors** - Custom error classes for framework-specific error handling
- 🕐 **Date/Time** - ISO8601 timestamps with timezone support and relative time expressions

## Installation

```bash
npm install @nmakarov/cli-toolkit
```

## Requirements

- **Node.js**: v20.0.0 or higher (recommended: v24+)
- **For Screen module**: `ink` and `react` as peer dependencies

```bash
# Install peer dependencies for interactive UIs
npm install ink react
```

## Quick Start

### Args - Parse Command Line Arguments

```typescript
import { Args } from '@nmakarov/cli-toolkit/args';

const args = new Args({
    aliases: { v: 'verbose', p: 'port' }
});

console.log(args.get('port'));      // Get value
console.log(args.getCommands());    // Get commands
console.log(args.getUnused());      // Get unused keys
```

```bash
node app.js --verbose --port=8080 build deploy
```

[📖 Full Args Documentation](docs/ARGS.md)

### Params - Validate Parameters

```typescript
import { Params } from '@nmakarov/cli-toolkit/params';
import { Args } from '@nmakarov/cli-toolkit/args';

const args = new Args();
const params = new Params({ args });

const config = params.getAll({
    name: 'string required',
    port: 'number default 3000',
    debug: 'boolean default false',
    tags: 'array(string)',
    startDate: 'date'  // Enhanced date with relative time
});

console.log(config.name);       // Type-safe, validated
console.log(config.port);       // Number (3000 if not provided)
console.log(config.startDate);  // ISO8601 string
```

```bash
node app.js --name="My App" --port=8080 --tags="api,web" --startDate="-7d"
```

[📖 Full Params Documentation](docs/PARAMS.md)

### Screen - Interactive Terminal UIs

```typescript
import { showListScreen } from '@nmakarov/cli-toolkit/screen';
import { createElement as h } from 'react';
import { Text } from 'ink';

const choice = await showListScreen({
    title: "Main Menu",
    items: [
        { name: "Build", value: "build" },
        { name: "Test", value: "test" },
        { name: "Deploy", value: "deploy" }
    ],
    onSelect: (value) => value,
    onEscape: () => null
});

console.log(`Selected: ${choice}`);
```

[📖 Full Screen Documentation](docs/SCREEN.md)

### Logger - Structured Logging

```typescript
import { CliToolkitLogger } from '@nmakarov/cli-toolkit/logger';

const logger = new CliToolkitLogger({
    prefix: 'APP',
    timestamp: true,
    progress: { withTimes: true }
});

logger.info('Application started');
logger.debug('Debug details', { config: true });
logger.warn('Warning message');
logger.error('Error occurred', new Error('Details'));

// Progress tracking with throttling
for (let i = 1; i <= 100; i++) {
    logger.progress('Processing', { prefix: 'task', count: i, total: 100 });
}

logger.results({ processed: 100, errors: 0 });
```

[📖 Full Logger Documentation](docs/LOGGER.md)

### Errors - Custom Error Classes

```typescript
import { ParamError, InitError, CriticalRequestError } from '@nmakarov/cli-toolkit/errors';

// Throw framework-specific errors
throw new ParamError('Invalid parameter: port must be a number');
throw new InitError('Failed to initialize database connection');
throw new CriticalRequestError('API endpoint unreachable');
```

## Module Overview

| Module | Purpose | Import Path |
|--------|---------|-------------|
| **Args** | Parse CLI arguments with config/env support | `@nmakarov/cli-toolkit/args` |
| **Params** | Type-safe parameter validation with Joi | `@nmakarov/cli-toolkit/params` |
| **Screen** | Interactive terminal UIs with React/Ink | `@nmakarov/cli-toolkit/screen` |
| **Logger** | Structured logging with progress tracking | `@nmakarov/cli-toolkit/logger` |
| **Errors** | Custom error classes | `@nmakarov/cli-toolkit/errors` |

## Examples

Try the interactive example launcher:

```bash
# Clone the repository
git clone https://github.com/nmakarov/cli-toolkit.git
cd cli-toolkit

# Install dependencies
npm install

# Launch interactive examples
npx tsx examples/example-runner.ts
```

Or run individual examples:

```bash
# Args examples
npx tsx examples/args/show-args.ts --verbose --output=file.txt
npx tsx examples/args/show-args-runner.ts  # Interactive

# Params examples
npx tsx examples/params/show-params-defaults.ts --name="My App"
npx tsx examples/params/time-params-playground.ts --startDate="2025-01-01T00:00:00Z" --endDate="@startDate+30d"

# Screen examples
npx tsx examples/screen/basic.ts  # Interactive demo

# Logger examples
npx tsx examples/logger/basic.ts
```

## Documentation

- **[Full Documentation](docs/README.md)** - Complete reference
- **[Args Module](docs/ARGS.md)** - Argument parsing details
- **[Params Module](docs/PARAMS.md)** - Parameter validation guide
- **[Screen Module](docs/SCREEN.md)** - Terminal UI framework
- **[Logger Module](docs/LOGGER.md)** - Logging capabilities
- **[Quick Reference](docs/QUICK_REFERENCE.md)** - Cheat sheet
- **[Examples](docs/EXAMPLES.md)** - Code examples
- **[API Reference](docs/API.md)** - Full API documentation
- **[Deployment Guide](DEPLOYMENT.md)** - Publishing workflow

## Testing

```bash
npm test               # Run all tests
npm run test:ci        # Run CI smoke tests with coverage
npm run test:args      # Test Args module
npm run test:params    # Test Params module
npm run test:screen    # Test Screen module
npm run test:logger    # Test Logger module
npm run test:coverage  # Generate coverage report
```

## Building

```bash
npm run build          # Build ESM and CommonJS outputs
npm run dev            # Watch mode for development
```

## Key Concepts

### Precedence Order (Args & Params)

Values are resolved in this order (highest to lowest priority):

1. **Overrides** - Explicitly set overrides
2. **Getters** - Registered getter functions
3. **CLI Arguments** - Command-line flags and options
4. **Environment Variables** - `.env` files and process.env
5. **Config Files** - JSON/JS configuration files
6. **Constructor Options** - Values passed to constructor
7. **Defaults** - Default values from definitions

### Cross-Parameter References (Params)

Calculate values based on other parameters:

```bash
# endDate is calculated as 2 hours after startDate
node app.js --startDate="2025-01-01T10:00:00Z" --endDate="@startDate+2h"
```

### Relative Time Expressions (Params)

```bash
node app.js --startDate="now"        # Current timestamp
node app.js --startDate="-7d"        # 7 days ago
node app.js --startDate="+2h"        # 2 hours from now
node app.js --endDate="@start+30d"   # 30 days after start param
```

Supported units: `s` (seconds), `m` (minutes), `h` (hours), `d` (days), `w` (weeks), `y` (years)

### ISO8601 Internal Representation

All timestamps are stored internally as UTC ISO8601 strings:
- **Format**: `YYYY-MM-DDTHH:mm:ss.sssZ`
- **Example**: `2025-01-01T10:30:00.000Z`
- **Benefits**: PostgreSQL compatible, JSON serializable, timezone unambiguous

## TypeScript Support

The toolkit is written in TypeScript with full type definitions:

```typescript
import { Args } from '@nmakarov/cli-toolkit/args';
import { Params } from '@nmakarov/cli-toolkit/params';
import { showListScreen } from '@nmakarov/cli-toolkit/screen';
import { CliToolkitLogger } from '@nmakarov/cli-toolkit/logger';

// Full IntelliSense and type checking
const args = new Args({ aliases: { v: 'verbose' } });
const params = new Params({ args });
const logger = new CliToolkitLogger({ prefix: 'APP' });
```

## CommonJS Support

All modules support both ESM and CommonJS:

```javascript
// ESM (TypeScript/Modern Node)
import { Args } from '@nmakarov/cli-toolkit/args';

// CommonJS (Traditional Node.js)
const { Args } = require('@nmakarov/cli-toolkit/args');
```

## Contributing

Contributions are welcome! Please read the [development documentation](docs/README.md) for details.

## License

MIT © nmakarov

## Links

- **GitHub**: https://github.com/nmakarov/cli-toolkit
- **npm**: https://www.npmjs.com/package/@nmakarov/cli-toolkit
- **Issues**: https://github.com/nmakarov/cli-toolkit/issues
- **Changelog**: [CHANGELOG.md](CHANGELOG.md)
- **Feature Tracker**: [FEATURES.md](FEATURES.md)
