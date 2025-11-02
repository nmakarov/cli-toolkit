# CLI Toolkit Documentation

Complete documentation for the `@nmakarov/cli-toolkit` package.

## Table of Contents

- [Installation](#installation)
- [Basic Usage](#basic-usage)
- [Screen System](#screen-system)
- [Precedence Order](#precedence-order)
- [Default Keys](#default-keys)
- [Argument Parsing](#argument-parsing)
- [Configuration Files](#configuration-files)
- [Environment Variables](#environment-variables)
- [Environment-Specific Features](#environment-specific-features)
- [API Reference](#api-reference)
- [Examples](#examples)

## Prerequisites

- **Node.js**: v20.0.0 or higher (recommended: v24+)
- **npm**: v8.0.0 or higher

## Installation

```bash
npm install @nmakarov/cli-toolkit
```

## Basic Usage

### Argument Parsing
```typescript
import { Args } from '@nmakarov/cli-toolkit';

// Simple usage
const args = new Args();
console.log(args.get('verbose')); // true if --verbose passed

// With configuration
const args = new Args({
  aliases: { 'v': 'verbose', 'd': 'debug' },
  defaults: { timeout: 5000 },
  overrides: { debug: false }
});
```

### Screen System
```typescript
import { showScreen, showListScreen, buildBreadcrumb } from '@nmakarov/cli-toolkit/screen';
import React, { createElement as h, Text, Box } from 'react';

// Interactive screen
const result = await showScreen({
    title: "Welcome",
    body: h(Box, { padding: 1 },
        h(Text, { color: "green" }, "Hello, World!")
    ),
    footer: "Press any key to continue"
});

// Interactive list
const choice = await showListScreen({
    title: buildBreadcrumb(["Menu", "Options"]),
    items: [
        { value: "option1", title: "Option 1" },
        { value: "option2", title: "Option 2" }
    ],
    onSelect: (item) => item.value,
    footer: "↑↓ to navigate, enter to select, esc to exit"
});
```

## Screen System

The screen system provides a powerful terminal UI framework for creating interactive CLI applications. It's built on top of Ink and React, offering rich layouts, navigation, and user input capabilities.

### Key Features

- **Interactive Lists** - Navigable lists with custom rendering, sorting, and scrolling
- **Multi-column Layouts** - Grid-based layouts with preview panes  
- **Breadcrumb Navigation** - Clear navigation hierarchy
- **Customizable UI Elements** - Text blocks, dividers, input fields
- **Keyboard Navigation** - Full keyboard support with customizable key bindings
- **Responsive Design** - Adapts to terminal width
- **TypeScript Support** - Full type safety and IntelliSense

### Quick Example

```typescript
import { showListScreen, buildBreadcrumb } from '@nmakarov/cli-toolkit/screen';
import React, { createElement as h, Text, Box } from 'react';

const showMainMenu = async () => {
    const options = [
        { value: "build", title: "Build Project", description: "Compile and build" },
        { value: "test", title: "Run Tests", description: "Execute test suite" },
        { value: "deploy", title: "Deploy", description: "Deploy to production" }
    ];

    return await showListScreen({
        title: buildBreadcrumb(["Main Menu"]),
        items: options,
        renderItem: (item, isSelected) => h(Box, { flexDirection: "column" },
            h(Text, { 
                color: isSelected ? "green" : "white",
                bold: isSelected 
            }, item.title),
            h(Text, { dimColor: true }, `   ${item.description}`)
        ),
        onSelect: (item) => item.value,
        footer: "↑↓ to navigate, enter to select, esc to exit"
    });
};
```

### Available Components

- **Screen Functions**: `showScreen()`, `showListScreen()`, `showMultiColumnListScreen()`
- **UI Elements**: `TextBlock`, `ListItem`, `Divider`, `InputField`
- **Layout Components**: `ScreenContainer`, `ScreenTitle`, `ScreenBody`, `ScreenFooter`
- **Utilities**: `buildBreadcrumb()`, `buildDetailBreadcrumb()`

For complete screen system documentation, see [Screen System Guide](screen/README.md).

## Running Examples

The repository ships with a collection of executable examples. The fastest way to explore them is through the interactive launcher:

```bash
npx tsx examples/example-runner.ts
```

The launcher groups demos by component (Args, Params, Screen) and shows multiple variants for each one. Non-interactive scripts stream their output back into the launcher, while Ink-based interactive demos temporarily take control of the terminal and return once finished.

Individual examples remain available if you prefer to invoke them directly, for instance:

```bash
npx tsx examples/args/show-args.ts --verbose
npx tsx examples/params/show-params.ts --dbName="analytics"
npx tsx examples/screen/basic.ts
```

## Testing

The toolkit ships with lightweight CI checks and richer development suites that live next to each component under `src/<component>/tests/`.

Common workflows:

```bash
npm test               # Run the entire Vitest suite
npm run test:ci        # Run *.ci.test.ts for all components (coverage enabled)
npm run test:args      # Run Args component tests
npm run test:args:ci   # Run Args CI smoke tests (coverage enabled)
npm run test:params    # Run Params component tests
npm run test:params:ci # Run Params CI smoke tests (coverage enabled)
npm run test:errors    # Run error-class tests
npm run test:errors:ci # Run error-class CI smoke tests (coverage enabled)
npm run test:screen    # Run Screen component tests
npm run test:screen:ci # Run Screen CI smoke tests (coverage enabled)
npm run test:logger    # Run Logger component tests
npm run test:logger:ci # Run Logger CI smoke tests (coverage enabled)
```

The `.ci.test.ts` files focus on fast sanity checks suitable for pipelines, while the broader `*.test.ts` suites capture deeper behaviour and regression coverage.

## Precedence Order

The CLI toolkit follows a strict precedence order when resolving values:

### Short Version
**`overrides > CLI args > config files > env vars > defaults`**

### Detailed Precedence

1. **Overrides** (constructor config) - Highest precedence
   ```typescript
   new Args({ overrides: { debug: false } })
   ```

2. **CLI args** (command line) - `--verbose`, `-v`, `--key=value`
   ```bash
   my-app --verbose --key=value
   ```

3. **Config files** (loaded from files) - `config.json`, `config.local.json`
   ```json
   { "debug": true, "timeout": 5000 }
   ```

4. **Environment variables** - `VERBOSE=true`, `KEY=value`
   ```bash
   export VERBOSE=true
   export KEY=value
   ```

5. **Defaults** (constructor config) - Lowest precedence
   ```typescript
   new Args({ defaults: { timeout: 5000 } })
   ```

### Environment-Specific Precedence

For environment-specific values, the precedence is:

1. **Environment-specific CLI args** - `--debug_local`, `--verbose_production`
2. **Regular CLI args** - `--debug`, `--verbose`
3. **Environment-specific config** - `config.local.json`, `config.production.json`
4. **Regular config** - `config.json`
5. **Environment-specific env vars** - `DEBUG_LOCAL`, `VERBOSE_PRODUCTION`
6. **Regular env vars** - `DEBUG`, `VERBOSE`
7. **Defaults** - Constructor defaults

## Default Keys

The following keys are always available and have special behavior:

### `env`
- **Default**: `"local"`
- **Fallback**: `NODE_ENV` environment variable
- **Usage**: `--env=production`, `--env=test`
- **Environment-specific**: `--env_local=production`

### `dotEnvPath`
- **Default**: `process.cwd()`
- **Usage**: `--dotEnvPath=./configs`
- **Purpose**: Specify directory for .env files

### `dotEnvFile`
- **Default**: `".env"`
- **Usage**: `--dotEnvFile=.env.local`
- **Purpose**: Specify .env filename

### `configPath`
- **Default**: `process.cwd()`
- **Usage**: `--configPath=./configs`
- **Purpose**: Specify directory for config files

### `config` / `configs`
- **Default**: `""`
- **Usage**: `--config=app.json`, `--configs=app.json,db.json`
- **Purpose**: Specify config files to load

### `defaultConfigExtension`
- **Default**: `"js"`
- **Usage**: `--defaultConfigExtension=json`
- **Purpose**: Default extension for config files

## Argument Parsing

### Long Options
```bash
--verbose              # Boolean flag (true)
--debug=true           # String value
--timeout=5000         # Numeric value
--message="Hello"      # Quoted string
--key="value=with=equals"  # Quoted value with equals
```

### Short Options
```bash
-v                     # Boolean flag
-d=true                # String value
-t=5000                # Numeric value
```

### Short Flag Bundling
```bash
-vsd                   # Equivalent to -v -s -d
-vsd --output=file.txt # -v -s -d --output=file.txt
-vsdk=4                # -v -s -d -k=4
```

### Negative Flags
```bash
--no-debug             # Sets debug to false
--not-verbose          # Sets verbose to false
```

### Commands
```bash
build test deploy      # Commands (no -- prefix)
```

### Case-Insensitive
```bash
--VERBOSE              # Same as --verbose
--Debug=true           # Same as --debug=true
```

## Configuration Files

### File Formats
- **JSON**: `config.json`, `config.local.json`
- **JavaScript**: `config.js`, `config.local.js`

### Environment-Specific Files
```bash
# Loads config.json + config.local.json
--config=config.json --env=local

# Loads config.json + config.production.json  
--config=config.json --env=production
```

### File Resolution
1. **Absolute paths**: Used as-is
2. **Relative paths**: Resolved from `configPath` or `process.cwd()`
3. **Environment-specific**: `config.local.json`, `config.production.json`

### Example Config Files

**config.json:**
```json
{
  "debug": false,
  "timeout": 5000,
  "output": "dist/"
}
```

**config.local.json:**
```json
{
  "debug": true,
  "timeout": 1000
}
```

## Environment Variables

### Automatic Conversion
- `camelCase` → `CAMEL_CASE`
- `debugMode` → `DEBUG_MODE`
- `apiKey` → `API_KEY`

### Environment-Specific Variables
- `DEBUG_LOCAL` (when `--env=local`)
- `VERBOSE_PRODUCTION` (when `--env=production`)
- `TIMEOUT_TEST` (when `--env=test`)

### Example
```bash
export DEBUG=true
export TIMEOUT=5000
export DEBUG_LOCAL=true  # Only used when --env=local
```

## Environment-Specific Features

### CLI Arguments
```bash
--debug_local=true     # Environment-specific CLI arg
--verbose_production   # Environment-specific boolean flag
```

### Environment Variables
```bash
export DEBUG_LOCAL=true
export VERBOSE_PRODUCTION=true
```

### Config Files
```bash
config.local.json      # Local environment
config.production.json # Production environment
config.test.json       # Test environment
```

### .env Files
```bash
.env.local            # Local environment
.env.production       # Production environment
.env.test             # Test environment
```

## API Reference

### Args Class

#### Constructor
```typescript
new Args(config?: ArgsConfig)
```

**ArgsConfig:**
```typescript
interface ArgsConfig {
  args?: string[];                    // Default: process.argv.slice(2)
  aliases?: Record<string, string>;   // Short → long mapping
  overrides?: Record<string, any>;    // Highest precedence
  defaults?: Record<string, any>;     // Lowest precedence
  prefixes?: string[];                // Negative flag prefixes
}
```

#### Methods

##### `get(key: string): any`
Get a value with full precedence resolution.

```typescript
const value = args.get('verbose');
const timeout = args.get('timeout');
```

##### `set(key: string, value: any): void`
Set a value (for testing/internal use).

```typescript
args.set('debug', true);
```

##### `hasCommand(cmd: string): boolean`
Check if a command exists (case-insensitive).

```typescript
if (args.hasCommand('build')) {
  // Build command was passed
}
```

##### `getCommands(): string[]`
Get all commands.

```typescript
const commands = args.getCommands(); // ['build', 'test']
```

##### `getUsed(): string[]`
Get all used keys.

```typescript
const used = args.getUsed(); // ['verbose', 'debug']
```

##### `getUnused(): string[]`
Get all unused keys.

```typescript
const unused = args.getUnused(); // ['silent', 'help']
```

##### `setPrefixes(prefixes: string | string[]): void`
Set negative flag prefixes dynamically.

```typescript
args.setPrefixes(['not', 'disable']);
// Now --not-debug and --disable-verbose work
```

##### `getParsed(): ParsedArgs`
Get all parsed data.

```typescript
const parsed = args.getParsed();
// { command: 'build', flags: {...}, options: {...}, usedKeys: Set(...) }
```

### Singleton Pattern

#### `init(args?: string[]): Args`
Initialize singleton instance.

```typescript
import { init } from '@nmakarov/cli-toolkit';
const args = init(['--verbose']);
```

#### `getArgsInstance(): Args | null`
Get current singleton instance.

```typescript
import { getArgsInstance } from '@nmakarov/cli-toolkit';
const args = getArgsInstance();
```

## Examples

### Basic Example
```typescript
import { Args } from '@nmakarov/cli-toolkit';

const args = new Args({
  aliases: { 'v': 'verbose', 'd': 'debug' },
  defaults: { timeout: 5000 }
});

if (args.hasCommand('build')) {
  const verbose = args.get('verbose');
  const timeout = args.get('timeout');
  console.log(`Building with verbose=${verbose}, timeout=${timeout}`);
}
```

### Environment-Specific Example
```typescript
const args = new Args({
  aliases: { 'v': 'verbose', 'd': 'debug' }
});

// Supports:
// --env=production
// --debug_production=true
// DEBUG_PRODUCTION=true
// config.production.json
// .env.production
```

### Config File Example
```typescript
const args = new Args({
  args: ['--config=app.json', '--env=local']
});

// Loads:
// 1. app.json
// 2. app.local.json (if exists)
// 3. .env.local (if exists)
```

### Short Flag Example
```typescript
const args = new Args({
  aliases: { 'v': 'verbose', 's': 'silent', 'd': 'debug' }
});

// Supports:
// -vsd (equivalent to -v -s -d)
// -vsd --output=file.txt
// -vsdk=4 (equivalent to -v -s -d -k=4)
```

### Negative Flag Example
```typescript
const args = new Args({
  prefixes: ['not', 'disable']
});

// Supports:
// --no-debug
// --not-verbose
// --disable-silent
```

## Best Practices

1. **Use aliases** for common short flags
2. **Set defaults** for required values
3. **Use environment-specific** configs for different environments
4. **Validate required** arguments after parsing
5. **Use overrides** for testing scenarios

## Migration from Legacy

The TypeScript version is fully compatible with the legacy JavaScript version:

```javascript
// Legacy
const { Args } = require('./legacy/Args.js');
const args = new Args();

// New
import { Args } from '@nmakarov/cli-toolkit';
const args = new Args();
```

All legacy features are supported with additional TypeScript benefits.
