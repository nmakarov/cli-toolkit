# Quick Reference

## Precedence Order
```
overrides > CLI args > config files > env vars > defaults
```

## Default Keys
- `env` - Environment (default: "local", fallback: NODE_ENV)
- `dotEnvPath` - .env file directory (default: process.cwd())
- `dotEnvFile` - .env filename (default: ".env")
- `configPath` - Config file directory (default: process.cwd())
- `config`/`configs` - Config files to load
- `defaultConfigExtension` - Default config extension (default: "js")

## Argument Formats
```bash
# Long options
--verbose              # Boolean (true)
--debug=true           # String value
--message="Hello"      # Quoted string

# Short options  
-v                     # Boolean
-d=true                # String value

# Short flag bundling
-vsd                   # -v -s -d
-vsdk=4                # -v -s -d -k=4

# Negative flags
--no-debug             # Sets debug to false
--not-verbose          # Sets verbose to false

# Commands
build test deploy      # No -- prefix
```

## Testing Commands
```bash
npm test               # Full suite
npm run test:ci        # *.ci.test.ts across components (coverage)
npm run test:args      # Args component tests
npm run test:params    # Params component tests
npm run test:errors    # Error-class tests
npm run test:screen    # Screen component tests
npm run test:logger    # Logger component tests
```

## Example Runner
```bash
npx tsx examples/example-runner.ts
```
Launches an interactive menu that groups Args, Params, and Screen demos with multiple variations.

## Environment-Specific
```bash
# CLI args
--debug_local=true     # Environment-specific
--verbose_production   # Environment-specific

# Environment variables
DEBUG_LOCAL=true       # Environment-specific
VERBOSE_PRODUCTION=true

# Config files
config.local.json      # Environment-specific
config.production.json

# .env files
.env.local             # Environment-specific
.env.production
```

## API Quick Reference

### Args Class
```typescript
// Constructor
new Args({
  aliases: { 'v': 'verbose' },
  defaults: { timeout: 5000 },
  overrides: { debug: false }
});

// Methods
args.get('key')                    // Get value
args.set('key', value)            // Set value
args.hasCommand('build')          // Check command
args.getCommands()                // Get all commands
args.getUsed()                    // Get used keys
args.getUnused()                  // Get unused keys
args.setPrefixes(['not'])         // Set negative prefixes
args.getParsed()                  // Get all data

// Singleton
init(['--verbose'])               // Initialize singleton
getArgsInstance()                 // Get singleton instance
```

### Screen System
```typescript
// Basic screen
await showScreen({
  title: "Welcome",
  body: h(Text, {}, "Hello World"),
  footer: "Press any key to continue"
});

// Interactive list
await showListScreen({
  title: buildBreadcrumb(["Menu"]),
  items: [{ value: "option1", title: "Option 1" }],
  onSelect: (item) => item.value,
  sortable: true,
  maxHeight: 10
});

// UI Components
h(TextBlock, { text: "Multi-line\ntext", color: "green" })
h(ListItem, { title: "Item", isSelected: true })
h(Divider, { width: 50, color: "cyan" })

// Utilities
buildBreadcrumb(["Menu", "Settings"])  // "Menu → Settings"
buildDetailBreadcrumb(["Menu"], "Item", "Details")  // "← Menu ← "Item" Details"
```

## File Resolution
```
Config files: configPath + filename + .env + .extension
.env files: dotEnvPath + .env + .env
Environment-specific: .env.local, .env.production, etc.
```
