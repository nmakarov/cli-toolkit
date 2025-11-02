# API Reference

## Exports

The package exports the following modules:

- `@nmakarov/cli-toolkit` - Main exports (Args, init, getArgsInstance)
- `@nmakarov/cli-toolkit/args` - Args class only
- `@nmakarov/cli-toolkit/screen` - Screen system components

## Args Class

### Constructor
```typescript
new Args(config?: ArgsConfig)
```

**ArgsConfig Interface:**
```typescript
interface ArgsConfig {
  args?: string[];                    // Default: process.argv.slice(2)
  aliases?: Record<string, string>;   // Short → long mapping
  overrides?: Record<string, any>;    // Highest precedence
  defaults?: Record<string, any>;     // Lowest precedence
  prefixes?: string[];                // Negative flag prefixes
}
```

### Methods

#### `get(key: string): any`
Get a value with full precedence resolution.

**Parameters:**
- `key` (string): The key to retrieve

**Returns:**
- `any`: The resolved value or `undefined`

**Example:**
```typescript
const verbose = args.get('verbose');
const timeout = args.get('timeout');
```

#### `set(key: string, value: any): void`
Set a value (for testing/internal use).

**Parameters:**
- `key` (string): The key to set
- `value` (any): The value to set

**Example:**
```typescript
args.set('debug', true);
```

#### `hasCommand(cmd: string): boolean`
Check if a command exists (case-insensitive).

**Parameters:**
- `cmd` (string): The command to check

**Returns:**
- `boolean`: True if command exists

**Example:**
```typescript
if (args.hasCommand('build')) {
  // Build command was passed
}
```

#### `getCommands(): string[]`
Get all commands.

**Returns:**
- `string[]`: Array of all commands

**Example:**
```typescript
const commands = args.getCommands(); // ['build', 'test']
```

#### `getUsed(): string[]`
Get all used keys.

**Returns:**
- `string[]`: Array of all used keys

**Example:**
```typescript
const used = args.getUsed(); // ['verbose', 'debug']
```

#### `getUnused(): string[]`
Get all unused keys.

**Returns:**
- `string[]`: Array of all unused keys

**Example:**
```typescript
const unused = args.getUnused(); // ['silent', 'help']
```

#### `setPrefixes(prefixes: string | string[]): void`
Set negative flag prefixes dynamically.

**Parameters:**
- `prefixes` (string | string[]): Prefixes to set

**Example:**
```typescript
args.setPrefixes(['not', 'disable']);
// Now --not-debug and --disable-verbose work
```

#### `getParsed(): ParsedArgs`
Get all parsed data.

**Returns:**
- `ParsedArgs`: Complete parsed data

**ParsedArgs Interface:**
```typescript
interface ParsedArgs {
  command: string;
  flags: Record<string, boolean>;
  options: Record<string, string>;
  usedKeys: Set<string>;
}
```

**Example:**
```typescript
const parsed = args.getParsed();
// { command: 'build', flags: {...}, options: {...}, usedKeys: Set(...) }
```

## Singleton Functions

### `init(args?: string[]): Args`
Initialize singleton instance.

**Parameters:**
- `args` (string[]): Optional arguments array

**Returns:**
- `Args`: The singleton instance

**Example:**
```typescript
import { init } from '@nmakarov/cli-toolkit';
const args = init(['--verbose']);
```

### `getArgsInstance(): Args | null`
Get current singleton instance.

**Returns:**
- `Args | null`: The singleton instance or null

**Example:**
```typescript
import { getArgsInstance } from '@nmakarov/cli-toolkit';
const args = getArgsInstance();
```

## Interfaces

### ArgsConfig
```typescript
interface ArgsConfig {
  args?: string[];                    // Default: process.argv.slice(2)
  aliases?: Record<string, string>;   // Short → long mapping
  overrides?: Record<string, any>;    // Highest precedence
  defaults?: Record<string, any>;     // Lowest precedence
  prefixes?: string[];                // Negative flag prefixes
}
```

### ParsedArgs
```typescript
interface ParsedArgs {
  command: string;                    // First command
  flags: Record<string, boolean>;    // Boolean flags
  options: Record<string, string>;   // String options
  usedKeys: Set<string>;             // Used keys
}
```

## Default Keys

The following keys are always available and have special behavior:

| Key | Default | Fallback | Description |
|-----|---------|----------|-------------|
| `env` | `"local"` | `NODE_ENV` | Environment name |
| `dotEnvPath` | `process.cwd()` | - | .env file directory |
| `dotEnvFile` | `".env"` | - | .env filename |
| `configPath` | `process.cwd()` | - | Config file directory |
| `config`/`configs` | `""` | - | Config files to load |
| `defaultConfigExtension` | `"js"` | - | Default config extension |

## Precedence Order

1. **Overrides** (constructor config) - Highest precedence
2. **CLI args** (command line) - `--verbose`, `-v`, `--key=value`
3. **Config files** (loaded from files) - `config.json`, `config.local.json`
4. **Environment variables** - `VERBOSE=true`, `KEY=value`
5. **Defaults** (constructor config) - Lowest precedence

### Environment-Specific Precedence

For environment-specific values:

1. **Environment-specific CLI args** - `--debug_local`, `--verbose_production`
2. **Regular CLI args** - `--debug`, `--verbose`
3. **Environment-specific config** - `config.local.json`, `config.production.json`
4. **Regular config** - `config.json`
5. **Environment-specific env vars** - `DEBUG_LOCAL`, `VERBOSE_PRODUCTION`
6. **Regular env vars** - `DEBUG`, `VERBOSE`
7. **Defaults** - Constructor defaults

## Screen System

### Core Functions

#### `showScreen(config: ShowScreenConfig): Promise<any>`
Display a basic screen with custom content.

**ShowScreenConfig:**
```typescript
interface ShowScreenConfig {
  title: string;
  body: JSX.Element;
  footer?: string | string[];
  onEscape?: () => any;
  onKeyPress?: (key: string) => void;
}
```

#### `showListScreen(config: ShowListScreenConfig): Promise<any>`
Display an interactive list screen.

**ShowListScreenConfig:**
```typescript
interface ShowListScreenConfig {
  title: string;
  items: ListItem[];
  onSelect: (item: ListItem) => any;
  onEscape?: () => any;
  renderItem?: (item: ListItem, isSelected: boolean, displayIndex: number, totalItems: number) => JSX.Element;
  getTitle?: (item: ListItem) => string;
  sortable?: boolean;
  maxHeight?: number;
  selectionMarker?: string;
  sortHighlightStyle?: TextStyle;
  footer?: string | string[];
}
```

#### `showMultiColumnListScreen(config: ShowMultiColumnListScreenConfig): Promise<any>`
Display a multi-column list screen.

#### `showMultiColumnListWithPreviewScreen(config: ShowMultiColumnListWithPreviewScreenConfig): Promise<any>`
Display a multi-column list with preview pane.

### UI Components

#### `TextBlock`
Multi-line text display component.

**Props:**
```typescript
interface TextBlockProps {
  text: string;
  color?: string;
  dimColor?: boolean;
  bold?: boolean;
  padding?: number;
  margin?: number;
}
```

#### `ListItem`
Individual list item component.

**Props:**
```typescript
interface ListItemProps {
  title: string;
  description?: string;
  isSelected?: boolean;
  color?: string;
  dimColor?: boolean;
  bold?: boolean;
}
```

#### `Divider`
Horizontal divider line.

**Props:**
```typescript
interface DividerProps {
  width?: number;
  color?: string;
  dimColor?: boolean;
}
```

### Layout Components

#### `ScreenContainer`
Main screen wrapper with border and padding.

#### `ScreenTitle`
Screen title with breadcrumb support.

#### `ScreenBody`
Main content area.

#### `ScreenFooter`
Footer area with customizable styling.

### Utility Functions

#### `buildBreadcrumb(items: string[]): string`
Build a breadcrumb string from an array of items.

```typescript
buildBreadcrumb(["Menu", "Settings", "General"]);
// Returns: "Menu → Settings → General"
```

#### `buildDetailBreadcrumb(items: string[], currentItem: string, detailType: string): string`
Build a detail breadcrumb with current item.

```typescript
buildDetailBreadcrumb(["Menu", "Items"], "Selected Item", "Details");
// Returns: "← Menu ← Items ← "Selected Item" Details"
```

### Types

#### `ListItem`
```typescript
interface ListItem {
  value: any;
  title: string;
  description?: string;
  [key: string]: any;
}
```

#### `TextStyle`
```typescript
interface TextStyle {
  color?: string;
  dimColor?: boolean;
  bold?: boolean;
  inverse?: boolean;
}
```
