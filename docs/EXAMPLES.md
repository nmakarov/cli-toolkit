# Examples

## Interactive Example Runner

Launch the bundled menu to explore the examples without memorizing command lines:

```bash
npx tsx examples/example-runner.ts
```

The runner groups demos by component (Args, Params, Screen), highlights common parameter variations, and executes the selected script. Non-interactive samples stream their output back to the runner; interactive Ink demos temporarily take over the terminal and then return to the menu when they exit.

## Basic Usage

### Simple Argument Parsing
```typescript
import { Args } from '@nmakarov/cli-toolkit';

const args = new Args();

// Command line: my-app --verbose --debug
console.log(args.get('verbose')); // true
console.log(args.get('debug'));   // true
console.log(args.hasCommand('build')); // false
```

### With Aliases and Defaults
```typescript
const args = new Args({
  aliases: {
    'v': 'verbose',
    'd': 'debug',
    's': 'silent'
  },
  defaults: {
    timeout: 5000,
    output: 'dist/'
  }
});

// Command line: my-app -v -d --timeout=3000
console.log(args.get('verbose')); // true (from -v)
console.log(args.get('debug'));   // true (from -d)
console.log(args.get('timeout')); // 3000 (CLI overrides default)
console.log(args.get('output')); // 'dist/' (from default)
```

## Environment-Specific Features

### Environment-Specific CLI Arguments
```typescript
const args = new Args({
  aliases: { 'v': 'verbose', 'd': 'debug' }
});

// Command line: my-app --env=local --debug_local=true --verbose_production=false
console.log(args.get('env'));     // 'local'
console.log(args.get('debug'));   // true (from --debug_local)
console.log(args.get('verbose')); // false (from --verbose_production)
```

### Environment-Specific Environment Variables
```bash
# Set environment variables
export DEBUG_LOCAL=true
export VERBOSE_PRODUCTION=false
export TIMEOUT_TEST=1000
```

```typescript
const args = new Args({
  args: ['--env=local']
});

console.log(args.get('debug'));   // true (from DEBUG_LOCAL)
console.log(args.get('verbose')); // false (from VERBOSE_PRODUCTION)
console.log(args.get('timeout')); // 1000 (from TIMEOUT_TEST)
```

## Configuration Files

### Basic Config Loading
```json
// config.json
{
  "debug": false,
  "timeout": 5000,
  "output": "dist/",
  "database": {
    "host": "localhost",
    "port": 5432
  }
}
```

```typescript
const args = new Args({
  args: ['--config=config.json']
});

console.log(args.get('debug'));   // false (from config)
console.log(args.get('timeout')); // 5000 (from config)
console.log(args.get('output'));  // 'dist/' (from config)
```

### Environment-Specific Configs
```json
// config.json
{
  "debug": false,
  "timeout": 5000,
  "output": "dist/"
}

// config.local.json
{
  "debug": true,
  "timeout": 1000
}

// config.production.json
{
  "debug": false,
  "timeout": 30000,
  "output": "/var/www/app/"
}
```

```typescript
// Command line: my-app --config=config.json --env=local
const args = new Args({
  args: ['--config=config.json', '--env=local']
});

console.log(args.get('debug'));   // true (from config.local.json)
console.log(args.get('timeout')); // 1000 (from config.local.json)
console.log(args.get('output'));  // 'dist/' (from config.json)
```

## Dotenv Integration

### Basic .env Loading
```bash
# .env
DEBUG=true
TIMEOUT=5000
API_KEY=secret123
```

```typescript
const args = new Args();

console.log(args.get('debug'));   // true (from .env)
console.log(args.get('timeout')); // 5000 (from .env)
console.log(args.get('apiKey')); // 'secret123' (from .env)
```

### Environment-Specific .env Files
```bash
# .env.local
DEBUG=true
TIMEOUT=1000

# .env.production
DEBUG=false
TIMEOUT=30000
```

```typescript
// Command line: my-app --env=local
const args = new Args({
  args: ['--env=local']
});

console.log(args.get('debug'));   // true (from .env.local)
console.log(args.get('timeout')); // 1000 (from .env.local)
```

## Advanced Argument Parsing

### Short Flag Bundling
```typescript
const args = new Args({
  aliases: {
    'v': 'verbose',
    's': 'silent',
    'd': 'debug',
    'k': 'key'
  }
});

// Command line: my-app -vsd
console.log(args.get('verbose')); // true
console.log(args.get('silent'));  // true
console.log(args.get('debug'));  // true

// Command line: my-app -vsdk=4
console.log(args.get('verbose')); // true
console.log(args.get('silent'));  // true
console.log(args.get('debug'));  // true
console.log(args.get('key'));    // '4'
```

### Negative Flags
```typescript
const args = new Args({
  prefixes: ['not', 'no', 'disable']
});

// Command line: my-app --no-debug --not-verbose --disable-silent
console.log(args.get('debug'));   // false
console.log(args.get('verbose')); // false
console.log(args.get('silent'));  // false
```

### Quoted Values
```typescript
// Command line: my-app --message="Hello World" --key="value=with=equals"
const args = new Args();

console.log(args.get('message')); // 'Hello World'
console.log(args.get('key'));     // 'value=with=equals'
```

## Precedence Examples

### CLI Overrides Config
```json
// config.json
{
  "debug": false,
  "timeout": 5000
}
```

```typescript
// Command line: my-app --config=config.json --debug=true --timeout=3000
const args = new Args({
  args: ['--config=config.json', '--debug=true', '--timeout=3000']
});

console.log(args.get('debug'));   // true (CLI overrides config)
console.log(args.get('timeout')); // 3000 (CLI overrides config)
```

### Environment Variables Override Defaults
```typescript
const args = new Args({
  defaults: { timeout: 5000 }
});

// Set environment variable: export TIMEOUT=3000
console.log(args.get('timeout')); // 3000 (env var overrides default)
```

### Overrides Override Everything
```typescript
const args = new Args({
  overrides: { debug: false },
  defaults: { debug: true }
});

// Command line: my-app --debug=true
console.log(args.get('debug')); // false (overrides override CLI)
```

## Singleton Pattern

### Basic Singleton Usage
```typescript
import { init, getArgsInstance } from '@nmakarov/cli-toolkit';

// Initialize singleton
const args = init(['--verbose', '--debug']);

// Get singleton instance elsewhere
const sameArgs = getArgsInstance();
console.log(sameArgs === args); // true
console.log(sameArgs.get('verbose')); // true
```

### Dynamic Prefix Setting
```typescript
const args = new Args({
  args: ['--not-debug', '--disable-verbose']
});

// Set prefixes dynamically
args.setPrefixes(['not', 'disable']);

console.log(args.get('debug'));   // false (from --not-debug)
console.log(args.get('verbose')); // false (from --disable-verbose)
```

## Screen System Examples

### Interactive Menu System
```typescript
import { showListScreen, buildBreadcrumb } from '@nmakarov/cli-toolkit/screen';
import React, { createElement as h, Text, Box } from 'react';

const showMainMenu = async () => {
    const options = [
        { value: "build", title: "Build Project", description: "Compile and build the project" },
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

// Usage
const choice = await showMainMenu();
console.log(`Selected: ${choice}`);
```

### Data Browser with Sorting and Scrolling
```typescript
import { showListScreen, buildBreadcrumb } from '@nmakarov/cli-toolkit/screen';
import React, { createElement as h, Text, Box } from 'react';

const showDataBrowser = async (data) => {
    return await showListScreen({
        title: buildBreadcrumb(["Data Browser"]),
        items: data,
        renderItem: (item, isSelected) => h(Box, { flexDirection: "row" },
            h(Text, { width: 20 }, item.name),
            h(Text, { width: 10 }, item.type),
            h(Text, { dimColor: true }, item.description)
        ),
        onSelect: (item) => showItemDetails(item),
        sortable: true,
        getTitle: (item) => item.name,
        maxHeight: 20,
        footer: "s to sort, ↑↓ to navigate, enter to view details"
    });
};
```

### Command Runner with Output Display
```typescript
import { showScreen, showListScreen } from '@nmakarov/cli-toolkit/screen';
import { spawn } from 'child_process';
import React, { createElement as h, Text, Box } from 'react';

const runCommand = async (command) => {
    return new Promise((resolve) => {
        const child = spawn('sh', ['-c', command], { stdio: 'pipe' });
        let output = '';
        
        child.stdout.on('data', (data) => {
            output += data.toString();
        });
        
        child.on('close', () => {
            resolve(output);
        });
    });
};

const showCommandRunner = async (commands) => {
    const choice = await showListScreen({
        title: "Command Runner",
        items: commands.map(cmd => ({ value: cmd, title: cmd.command, description: cmd.description })),
        onSelect: (item) => item.value,
        footer: "↑↓ to navigate, enter to run, esc to exit"
    });

    if (choice) {
        const output = await runCommand(choice.command);
        
        await showScreen({
            title: "Command Output",
            body: h(Box, { flexDirection: "column", padding: 1 },
                h(Text, { color: "green", bold: true }, "Command:"),
                h(Text, { color: "white" }, choice.command),
                h(Text, {}), // Empty line
                h(Text, { color: "green", bold: true }, "Output:"),
                h(Text, { color: "white" }, output)
            ),
            footer: "Press any key to continue"
        });
    }
};
```

## Real-World Examples

### Build Script
```typescript
import { Args } from '@nmakarov/cli-toolkit';

const args = new Args({
  aliases: { 'v': 'verbose', 'd': 'debug', 'o': 'output' },
  defaults: { 
    output: 'dist/',
    minify: false,
    sourcemap: true
  }
});

if (args.hasCommand('build')) {
  const verbose = args.get('verbose');
  const debug = args.get('debug');
  const output = args.get('output');
  const minify = args.get('minify');
  
  console.log(`Building to ${output} with verbose=${verbose}, debug=${debug}, minify=${minify}`);
}
```

### Server Configuration
```typescript
const args = new Args({
  args: ['--config=server.json', '--env=production'],
  defaults: {
    port: 3000,
    host: 'localhost'
  }
});

const config = {
  port: args.get('port'),
  host: args.get('host'),
  debug: args.get('debug'),
  timeout: args.get('timeout')
};

console.log('Server config:', config);
```

### CLI Tool with Commands
```typescript
const args = new Args({
  aliases: { 'v': 'verbose', 'h': 'help' }
});

if (args.hasCommand('help') || args.get('help')) {
  console.log('Usage: my-tool [command] [options]');
  console.log('Commands: build, test, deploy');
  console.log('Options: --verbose, --debug, --help');
} else if (args.hasCommand('build')) {
  console.log('Building...');
} else if (args.hasCommand('test')) {
  console.log('Testing...');
} else if (args.hasCommand('deploy')) {
  console.log('Deploying...');
} else {
  console.log('No command specified. Use --help for usage.');
}
```
