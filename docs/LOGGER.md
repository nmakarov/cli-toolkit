# Logger Module Documentation

The Logger module provides structured logging with multiple levels, progress tracking, and flexible output routing (console, IPC, or custom transports).

## Installation

```bash
npm install @nmakarov/cli-toolkit
```

## Basic Usage

```typescript
import { CliToolkitLogger } from '@nmakarov/cli-toolkit/logger';

const logger = new CliToolkitLogger({
    prefix: 'APP',
    timestamp: true,
    showLevel: true
});

logger.info('Application started');
logger.debug('Debug information', { config: true });
logger.warn('Warning message');
logger.error('Error occurred', new Error('Details'));
```

## Features

- 📊 **Multiple Log Levels** - debug, info, notice, warn, error, and more
- 🎨 **Colored Output** - Level-specific colors for better readability
- ⏱️ **Timestamps** - Optional ISO8601 timestamps
- 🏷️ **Prefixes** - Add context with custom prefixes
- 📈 **Progress Tracking** - Built-in progress reporting with ETA
- 🚦 **Throttling** - Limit progress message frequency
- 🔀 **Multiple Routes** - Console, parent process (IPC), or custom transports
- 📝 **Text & JSON Modes** - Formatted text or structured JSON output
- 🎯 **Level Filtering** - Include/exclude specific levels
- 🔇 **Silent Mode** - Suppress all output

## Log Levels

Available log levels (in order of severity):

| Level | Purpose | Color |
|-------|---------|-------|
| `error` | Critical errors | Red (bold) |
| `warn` | Warnings | Orange |
| `notice` | Important notices | Cyan |
| `info` | General information | White (bold) |
| `logic` | Business logic flow | Gray |
| `debug` | Debug information | Gray |
| `silly` | Verbose debugging | Gray |
| `request` | API/HTTP requests | Green |
| `response` | API/HTTP responses | Yellow |
| `progress` | Progress updates | Green |
| `results` | Final results/summary | Magenta |

## Constructor Options

```typescript
const logger = new CliToolkitLogger({
    // Output mode: "text" (formatted) or "json" (structured)
    mode: 'text',
    
    // Output route: "console" or "ipc" (parent process)
    route: 'console',
    
    // Prefix for all messages
    prefix: 'MY-APP',
    
    // Suppress all output
    silent: false,
    
    // Show log level in output
    showLevel: true,
    
    // Add ISO8601 timestamp to each message
    timestamp: true,
    
    // Filter which levels to output
    levels: ['info', 'warn', 'error'],  // Only these levels
    // levels: ['info', 'debug', '-silly'],  // All except silly
    
    // Progress options
    progress: {
        withTimes: true,        // Show elapsed/remaining time
        throttleMs: 1000        // Min ms between progress messages
    }
});
```

## Methods

### Standard Levels

```typescript
logger.debug(message, ...chunks);
logger.info(message, ...chunks);
logger.notice(message, ...chunks);
logger.warn(message, ...chunks);
logger.error(message, ...chunks);
logger.logic(message, ...chunks);
logger.silly(message, ...chunks);
```

**Example:**
```typescript
logger.info('User logged in', { userId: 123, ip: '192.168.1.1' });
logger.error('Database error', error, { query: 'SELECT * FROM users' });
```

### Special Levels

#### `results(data: any)`

Log final results or summary data:

```typescript
logger.results({
    processed: 1000,
    errors: 5,
    duration: '2.5s'
});
```

#### `request(operation: string, ...chunks: any[])`

Log API/HTTP requests:

```typescript
logger.request('GET /api/users', { params: { limit: 10 } });
```

#### `response(operation: string, ...chunks: any[])`

Log API/HTTP responses:

```typescript
logger.response('GET /api/users', { status: 200, count: 10 });
```

#### `progress(message: string, options: ProgressOptions)`

Track progress with automatic timing:

```typescript
for (let i = 1; i <= 100; i++) {
    logger.progress('Processing items', {
        prefix: 'import',
        count: i,
        total: 100
    });
}
```

**Progress Options:**
- `prefix` - Unique identifier for this progress task
- `count` - Current item number
- `total` - Total items to process

**Output:**
```
PROGRESS import 1/100 Processing items 0/-1
PROGRESS import 50/100 Processing items 12.5/12.5
PROGRESS import 100/100 Processing items 25/0
```

### Mode Control

```typescript
// Switch between text and JSON mode
logger.setMode('json');
logger.info('Now outputs JSON');
// Output: {"level":"info","message":"Now outputs JSON","chunks":[]}

logger.setMode('text');
logger.info('Back to text');
// Output: INFO Back to text
```

## Output Routing

### Console Output (Default)

```typescript
const logger = new CliToolkitLogger({ route: 'console' });
logger.info('Goes to console.info()');
```

### Parent Process (IPC)

For child processes sending logs to parent:

```typescript
// child.js
const logger = new CliToolkitLogger({ route: 'ipc' });
logger.info('Sent to parent via process.send()');

// parent.js
const child = spawn('node', ['child.js']);
child.on('message', (msg) => {
    console.log('From child:', msg);
});
```

## Level Filtering

### Include Specific Levels

```typescript
const logger = new CliToolkitLogger({
    levels: ['error', 'warn', 'info']
});

logger.debug('Not logged');
logger.info('Logged');
logger.error('Logged');
```

### Exclude Specific Levels

```typescript
const logger = new CliToolkitLogger({
    levels: ['-debug', '-silly']  // All except debug and silly
});

logger.info('Logged');
logger.debug('Not logged');
```

## Progress Tracking

### Basic Progress

```typescript
const total = 100;
for (let count = 1; count <= total; count++) {
    logger.progress('Processing', { 
        prefix: 'task',
        count, 
        total 
    });
}
```

**Output:**
```
PROGRESS task 1/100 Processing
PROGRESS task 50/100 Processing
PROGRESS task 100/100 Processing
```

### Progress with Timing

```typescript
const logger = new CliToolkitLogger({
    progress: { withTimes: true }
});

for (let i = 1; i <= 100; i++) {
    await processItem(i);
    logger.progress('Items', { 
        prefix: 'import',
        count: i,
        total: 100 
    });
}
```

**Output:**
```
PROGRESS import 1/100 Items 0/-1
PROGRESS import 50/100 Items 5.2/5.2
PROGRESS import 100/100 Items 10.5/0
```

Format: `elapsed/remaining` in seconds

### Progress Throttling

Limit how often progress messages are logged:

```typescript
const logger = new CliToolkitLogger({
    progress: { 
        withTimes: true,
        throttleMs: 1000  // Max one message per second
    }
});

// Only logs first, last, and messages 1+ seconds apart
for (let i = 1; i <= 1000; i++) {
    logger.progress('Fast loop', { 
        prefix: 'task',
        count: i,
        total: 1000 
    });
}
```

## Bootstrap Logger

For use during initialization before config is loaded:

```typescript
import { ConsoleFallbackLogger } from '@nmakarov/cli-toolkit/logger';

// Minimal logger for early boot
const fallback = new ConsoleFallbackLogger();
fallback.debug('Init starting');
fallback.warn('Config not loaded yet');
fallback.error('Critical init error');

// Later, swap to full logger
const logger = new CliToolkitLogger({ /* config */ });
```

## JSON Mode

For machine-readable output or log aggregation:

```typescript
const logger = new CliToolkitLogger({ mode: 'json' });

logger.info('Event occurred', { userId: 123 });
```

**Output:**
```json
{
    "level": "info",
    "message": "Event occurred",
    "chunks": [{ "userId": 123 }]
}
```

## Examples

### Simple Application Logger

```typescript
const logger = new CliToolkitLogger({
    prefix: 'myapp',
    timestamp: false,
    showLevel: true
});

logger.info('Starting application');
logger.debug('Loading configuration', { path: './config.json' });
logger.info('Server listening', { port: 3000 });
```

### Child Process with IPC

```typescript
// worker.ts
const logger = new CliToolkitLogger({ 
    route: 'ipc',
    mode: 'json' 
});

for (let i = 1; i <= 100; i++) {
    await processItem(i);
    logger.progress('Work', { prefix: 'worker', count: i, total: 100 });
}

// main.ts
const worker = spawn('node', ['worker.js']);
worker.on('message', (log) => {
    console.log(`[${log.level}] ${log.message}`);
});
```

### Development vs Production

```typescript
const isDev = process.env.NODE_ENV === 'development';

const logger = new CliToolkitLogger({
    levels: isDev 
        ? undefined  // All levels
        : ['error', 'warn', 'info'],  // Production: errors and info only
    timestamp: !isDev,  // Timestamps in production only
    showLevel: true,
    progress: { withTimes: !isDev }  // Timing in production only
});
```

## See Also

- [Args Module](ARGS.md) - Argument parsing
- [Params Module](PARAMS.md) - Parameter validation
- [Full Reference](FULL_REFERENCE.md) - Complete documentation
- [Examples](EXAMPLES.md) - More code examples

