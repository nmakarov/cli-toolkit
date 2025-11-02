# Args Module Documentation

The Args module provides powerful command-line argument parsing with support for config files, environment variables, and sophisticated precedence rules.

## Installation

```bash
npm install @nmakarov/cli-toolkit
```

## Basic Usage

```typescript
import { Args } from '@nmakarov/cli-toolkit/args';

const args = new Args();
console.log(args.get('verbose'));    // Get --verbose flag
console.log(args.getCommands());     // Get positional commands
```

## Features

- ✅ Short and long flags (`-v`, `--verbose`)
- ✅ Bundled short flags (`-vsd` = `-v -s -d`)
- ✅ Key-value pairs with `=` separator (`--port=8080`)
- ✅ Aliases (`-v` → `--verbose`)
- ✅ Case-insensitive matching
- ✅ Config file loading (JSON, JS)
- ✅ Environment variable integration
- ✅ `.env` file support with environment-specific variants
- ✅ Sophisticated precedence rules
- ✅ Command extraction
- ✅ Unused key detection

## Constructor Options

```typescript
const args = new Args({
    // Alias mapping
    aliases: { 
        v: 'verbose',
        p: 'port',
        o: 'output'
    },
    
    // Default values
    defaults: {
        port: 3000,
        timeout: 5000
    },
    
    // Override values (highest precedence)
    overrides: {
        debug: false
    },
    
    // Config file paths
    config: ['config.json', 'config.local.json'],
    
    // Environment name for .env loading
    env: 'production',  // Loads .env.production
    
    // Custom .env file
    dotEnvFile: '.env.custom',
    
    // .env file directory
    dotEnvPath: './config'
});
```

## Precedence Order

Values are resolved from highest to lowest priority:

1. **Overrides** - Constructor `overrides` option
2. **CLI Arguments** - Command-line flags/options
3. **Environment Variables** - `process.env`
4. **Config Files** - JSON/JS configuration files
5. **Constructor Options** - Values passed to constructor
6. **Defaults** - Constructor `defaults` option

## Examples

### Basic Argument Parsing

```typescript
import { Args } from '@nmakarov/cli-toolkit/args';

const args = new Args();

// node app.js --verbose --port=8080 --output=dist/
console.log(args.get('verbose'));  // true
console.log(args.get('port'));     // "8080"
console.log(args.get('output'));   // "dist/"
```

### With Aliases

```typescript
const args = new Args({
    aliases: { v: 'verbose', p: 'port' }
});

// node app.js -v -p 8080
// Same as: node app.js --verbose --port=8080
console.log(args.get('verbose'));  // true
console.log(args.get('port'));     // "8080"
```

### Bundled Short Flags

```bash
node app.js -vsd --output=dist/
# Expands to: --verbose --silent --debug --output=dist/
```

### Config Files

```typescript
// config.json
{
    "port": 8080,
    "host": "localhost",
    "features": ["auth", "logging"]
}

// app.ts
const args = new Args({
    config: 'config.json'
});

console.log(args.get('port'));      // 8080
console.log(args.get('host'));      // "localhost"
console.log(args.get('features'));  // ["auth", "logging"]
```

### Environment Variables

```typescript
// .env
PORT=9000
DEBUG=true
API_KEY=secret123

// app.ts
const args = new Args({
    dotEnvFile: '.env'
});

console.log(args.get('port'));     // "9000"
console.log(args.get('debug'));    // "true"
console.log(args.get('apiKey'));   // "secret123" (camelCase conversion)
```

### Environment-Specific Config

```typescript
const args = new Args({
    env: 'production',           // Loads .env.production
    config: 'config.json',       // Also loads config.production.json
    dotEnvPath: './config'
});

// Loads:
// - ./config/.env
// - ./config/.env.production
// - config.json
// - config.production.json
```

## API Reference

### Constructor

```typescript
new Args(options?: ArgsOptions)
```

**Options:**
- `aliases?: Record<string, string>` - Short-to-long key mappings
- `defaults?: Record<string, any>` - Default values
- `overrides?: Record<string, any>` - Override values (highest priority)
- `config?: string | string[]` - Config file path(s)
- `env?: string` - Environment name (e.g., 'production')
- `dotEnvFile?: string` - Custom .env filename
- `dotEnvPath?: string` - Directory containing .env files

### Methods

#### `get(key: string): any`

Get a parameter value by key.

```typescript
const value = args.get('port');
```

#### `getCommands(): string[]`

Get positional command arguments (non-flag arguments).

```typescript
// node app.js build deploy --verbose
const commands = args.getCommands();  // ['build', 'deploy']
```

#### `getUnused(): string[]`

Get keys that were parsed but never accessed via `get()`.

```typescript
// node app.js --verbose --unknown --port=8080
args.get('verbose');
args.get('port');
const unused = args.getUnused();  // ['unknown']
```

#### `getAll(): Record<string, any>`

Get all discovered key-value pairs.

```typescript
const all = args.getAll();
// { verbose: true, port: "8080", ... }
```

## Advanced Features

### Case Conversion

Keys are automatically converted to camelCase:

```bash
node app.js --api-key=123 --db-host=localhost
```

```typescript
console.log(args.get('apiKey'));   // "123"
console.log(args.get('dbHost'));   // "localhost"
```

### Config File Merging

Multiple config files are merged in order:

```typescript
const args = new Args({
    config: ['config.json', 'config.local.json', 'config.production.json']
});
// Later files override earlier ones
```

### Dynamic Config Loading

```typescript
// Load config at runtime
const args = new Args();
const configPath = args.get('config') || 'config.json';

const argsWithConfig = new Args({
    config: configPath
});
```

## Best Practices

1. **Use aliases for common flags**: Makes CLI more user-friendly
2. **Provide sensible defaults**: Reduces required arguments
3. **Use config files for complex setups**: Keeps command lines clean
4. **Leverage environment-specific configs**: Easy deployment across environments
5. **Check unused keys**: Helps catch typos in parameter names

## See Also

- [Params Module](PARAMS.md) - Type-safe parameter validation
- [Full Reference](FULL_REFERENCE.md) - Complete documentation
- [Examples](EXAMPLES.md) - More code examples
- [Quick Reference](QUICK_REFERENCE.md) - Command cheat sheet

