# Params Module Documentation

The Params module provides type-safe parameter validation using Joi schemas, with support for cross-parameter references and custom types.

## Installation

```bash
npm install @nmakarov/cli-toolkit
```

## Basic Usage

```typescript
import { Params } from '@nmakarov/cli-toolkit/params';
import { Args } from '@nmakarov/cli-toolkit/args';

const args = new Args();
const params = new Params({ args });

const config = params.getAll({
    name: 'string required',
    port: 'number default 3000',
    debug: 'boolean default false'
});

console.log(config.name);   // Validated string
console.log(config.port);   // Number (3000 if not provided)
console.log(config.debug);  // Boolean (false if not provided)
```

## Features

- ✅ String-based type definitions (`"string required"`, `"number default 100"`)
- ✅ Joi schema support (for complex validation)
- ✅ Custom types (`date`, `array(type)`)
- ✅ Cross-parameter references (`@paramName+offset`)
- ✅ Required/optional validation
- ✅ Default values
- ✅ Enum validation (allowed values)
- ✅ Array type coercion
- ✅ Getter/setter hooks
- ✅ Singleton pattern support

## Type Definitions

### String Syntax

Simple string-based definitions:

```typescript
params.getAll({
    name: 'string required',
    port: 'number default 3000',
    debug: 'boolean',
    timeout: 'number default 5000',
    tags: 'array(string) default api,web',
    count: 'array(number)',
    startDate: 'date default now'
});
```

**Format**: `<type> [required] [default <value>]`

**Supported types**:
- `string` / `text`
- `number` / `integer` / `int`
- `boolean` / `bool`
- `array(string)` / `array(number)` / `array(boolean)`
- `date` - Enhanced date (ISO8601 strings with relative time)
- `duration` - ISO8601 duration strings

### Object Syntax

For more control:

```typescript
params.getAll({
    logLevel: {
        type: 'string',
        values: ['debug', 'info', 'warn', 'error'],
        default: 'info'
    },
    port: {
        type: 'number',
        required: true
    }
});
```

### Joi Schema Syntax

For complex validation:

```typescript
import Joi from 'joi';

params.getAll({
    email: Joi.string().email().required(),
    age: Joi.number().min(0).max(120),
    password: Joi.string().min(8).pattern(/[A-Z]/).pattern(/[0-9]/)
});
```

## Enhanced Date Type (`date`)

The `date` type provides flexible date/time handling with ISO8601 internal representation.

### Supported Input Formats

```bash
# ISO8601 strings (passed through)
--startDate="2025-01-01T10:00:00Z"

# Relative time (from now)
--startDate="now"         # Current timestamp
--startDate="-7d"         # 7 days ago
--startDate="+2h"         # 2 hours from now
--startDate="-30m"        # 30 minutes ago

# Cross-parameter references
--startDate="2025-01-01T00:00:00Z" --endDate="@startDate+30d"
--eventTime="now" --reminderTime="@eventTime-1h"
```

### Time Units

- `s` - seconds
- `m` - minutes
- `h` - hours
- `d` - days
- `w` - weeks
- `y` - years (365 days)

### Internal Representation

All `date` values are stored as **UTC ISO8601 strings**:
- Format: `YYYY-MM-DDTHH:mm:ss.sssZ`
- Example: `2025-01-01T10:30:00.000Z`
- Always UTC timezone
- Compatible with PostgreSQL, JSON, and JavaScript Date

### Cross-Parameter References

Use `@paramName+offset` to calculate dates relative to other parameters:

```typescript
const config = params.getAll({
    startDate: 'date',
    endDate: 'date',
    reminderDate: 'date'
});
```

```bash
# endDate is 30 days after startDate
node app.js --startDate="2025-01-01T00:00:00Z" --endDate="@startDate+30d"

# reminderDate is 1 hour before startDate
node app.js --startDate="2025-06-15T14:00:00Z" --reminderDate="@startDate-1h"
```

**Important**: Parameters are evaluated left-to-right, so the referenced parameter must appear earlier in the definition object.

## Array Types

Arrays are parsed from comma-separated strings:

```typescript
const config = params.getAll({
    tags: 'array(string)',
    ports: 'array(number)',
    flags: 'array(boolean)'
});
```

```bash
node app.js --tags="api,web,db" --ports="8080,9000,3000" --flags="true,false,true"
```

Result:
```typescript
config.tags   // ["api", "web", "db"]
config.ports  // [8080, 9000, 3000]
config.flags  // [true, false, true]
```

## Enum Validation

Restrict values to specific options:

```typescript
const config = params.getAll({
    logLevel: {
        type: 'string',
        values: ['debug', 'info', 'warn', 'error'],
        default: 'info'
    },
    environment: {
        type: 'string',
        values: ['dev', 'staging', 'production'],
        required: true
    }
});
```

Invalid values throw a `ParamError`.

## Getter/Setter Hooks

Register custom logic for parameter retrieval and storage:

```typescript
const params = new Params({ args });

// Getter - compute values dynamically
params.registerParamGetter((key) => {
    if (key === 'timestamp') {
        return new Date().toISOString();
    }
    return undefined;  // Let normal flow handle it
});

// Setter - intercept and transform values
params.registerParamSetter((key, value) => {
    if (key === 'password') {
        // Hash password before storing
        hashAndStore(key, value);
        return true;  // Prevent default storage
    }
    return false;  // Use default storage
});
```

## API Reference

### Constructor

```typescript
new Params(
    { args: ArgsInstance },
    options?: Record<string, any>
)
```

### Methods

#### `assignDefinition(key: string, definition: ParamDefinition): void`

Register a parameter definition for validation.

#### `get(key: string, definition?: ParamDefinition): any`

Get and validate a single parameter.

```typescript
const port = params.get('port', 'number default 3000');
```

#### `set(key: string, value: any, definition?: ParamDefinition): void`

Set a parameter value with validation.

```typescript
params.set('port', 8080, 'number');
```

#### `getAll(definitions: Record<string, ParamDefinition>): Record<string, any>`

Get and validate all parameters at once.

```typescript
const config = params.getAll({
    name: 'string required',
    port: 'number default 3000',
    debug: 'boolean'
});
```

#### `validate(key: string, value: any, definition: any): any`

Validate a value against a definition (used internally).

#### `registerParamGetter(getter: ParamGetter): void`

Register a custom getter function.

#### `registerParamSetter(setter: ParamSetter): void`

Register a custom setter function.

### Singleton Helpers

```typescript
import { init, getParamsInstance } from '@nmakarov/cli-toolkit/params';

// Initialize singleton
const params = init({ args });

// Access singleton anywhere
const same = getParamsInstance();  // Returns same instance
```

## Error Handling

```typescript
import { ParamError } from '@nmakarov/cli-toolkit/errors';

try {
    const config = params.getAll({
        port: 'number required'
    });
} catch (error) {
    if (error instanceof ParamError) {
        console.error('Validation failed:', error.message);
        process.exit(1);
    }
    throw error;
}
```

## Examples

See the `examples/params/` directory for complete examples:

- `show-params.ts` - Basic parameter validation without defaults
- `show-params-defaults.ts` - Parameter validation with default values
- `time-params-playground.ts` - Date/time handling and timezone conversions

```bash
npx tsx examples/params/show-params-defaults.ts --name="My App" --port=8080
npx tsx examples/params/time-params-playground.ts --startDate="2025-01-01T00:00:00Z" --endDate="@startDate+30d"
```

## See Also

- [Args Module](ARGS.md) - Argument parsing
- [Logger Module](LOGGER.md) - Structured logging
- [Full Reference](FULL_REFERENCE.md) - Complete documentation
- [Examples](EXAMPLES.md) - More code examples

