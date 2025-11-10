# HttpClient - Resilient HTTP Client

A production-ready HTTP client built on top of axios with advanced retry logic, error classification, and unified response handling.

## Features

- 🚀 **Never Throws**: Always returns unified response objects, never throws exceptions
- 🔄 **Automatic Retry**: Exponential backoff with jitter to prevent thundering herd problems
- 🎯 **Human-Readable Errors**: Use-case oriented error names instead of technical codes
- 📡 **All HTTP Methods**: GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS
- ⚙️ **Flexible Configuration**: Per-client and per-request configuration overrides
- 📝 **Comprehensive Logging**: Debug, info, warning, and error logging
- 🔒 **TypeScript First**: Full type safety with comprehensive type definitions

## Installation

```bash
npm install @nmakarov/cli-toolkit
```

## Quick Start

```typescript
import { HttpClient } from '@nmakarov/cli-toolkit/http-client';

const client = new HttpClient({
    timeout: 10000,
    retryCount: 3
});

// Always returns a response object - never throws!
const response = await client.get('https://api.example.com/users');

if (response.status === 'success') {
    console.log('Users:', response.data);
} else {
    console.log('Error:', response.error); // 'connectionFailed', 'timeout', etc.
}
```

## Configuration

### HttpClientConfig

```typescript
interface HttpClientConfig {
    /** Request timeout in milliseconds (default: 30000) */
    timeout?: number;

    /** Maximum retry attempts (default: 3) */
    retryCount?: number;

    /** Base delay between retries in milliseconds (default: 1000) */
    retryDelay?: number;

    /** Maximum retry delay in milliseconds (default: 30000) */
    maxRetryDelay?: number;

    /** Jitter factor for retry delays (0-1, default: 0.1) */
    retryJitter?: number;

    /** User agent string (default: 'HttpClient/v1.0') */
    userAgent?: string;

    /** Validate SSL certificates (default: true) */
    validateSSL?: boolean;

    /** Maximum redirects to follow (default: 5) */
    maxRedirects?: number;

    /** Logger instance for debug/info/error logging */
    logger?: any;
}
```

### RequestOptions

```typescript
interface RequestOptions {
    /** Request timeout override (milliseconds) */
    timeout?: number;

    /** Headers to include in the request */
    headers?: Record<string, string>;

    /** Query parameters */
    params?: Record<string, any>;

    /** Request body data */
    data?: any;

    /** Override retry count for this request */
    retryCount?: number;

    /** Override retry delay for this request */
    retryDelay?: number;

    /** Whether to log request/response details */
    debug?: boolean;

    /** Custom user agent for this request */
    userAgent?: string;
}
```

## Response Format

HttpClient always returns a unified response object:

```typescript
interface HttpClientResponse {
    /** Custom status ('success', 'authRequired', 'clientError', etc.) */
    status: HttpClientStatus;

    /** HTTP status code (200, 404, 500, etc.) or null for network errors */
    code: number | null;

    /** Human-readable error type (only present on errors) */
    error?: HttpClientErrorType;

    /** Response headers */
    headers: Record<string, string> | null;

    /** Response data */
    data: any;

    /** Request duration in milliseconds */
    duration: number;

    /** Number of retry attempts made */
    retryCount: number;

    /** Final URL after redirects */
    finalUrl?: string;
}
```

## Usage Examples

### Basic GET Request

```typescript
const response = await client.get('https://jsonplaceholder.typicode.com/posts/1');

if (response.status === 'success') {
    console.log('Post:', response.data);
} else {
    console.error('Request failed:', response.error);
}
```

### POST with JSON Data

```typescript
const response = await client.post('https://jsonplaceholder.typicode.com/posts', {
    data: {
        title: 'New Post',
        body: 'This is the post content',
        userId: 1
    },
    headers: {
        'Content-Type': 'application/json'
    }
});

if (response.status === 'success') {
    console.log('Created post:', response.data);
}
```

### Custom Headers and Query Parameters

```typescript
const response = await client.get('https://api.example.com/search', {
    params: {
        q: 'typescript',
        limit: 10,
        sort: 'relevance'
    },
    headers: {
        'Authorization': 'Bearer your-token-here',
        'X-API-Key': 'your-api-key'
    }
});
```

### Per-Request Configuration

```typescript
// Override timeout and retry settings for this specific request
const response = await client.get('https://slow-api.example.com/data', {
    timeout: 60000,      // 60 second timeout
    retryCount: 1,       // Only retry once
    retryDelay: 5000,    // 5 second base delay
    debug: true          // Enable detailed logging
});
```

### Error Handling

```typescript
const response = await client.get('https://non-existent-domain.com');

// Check for different error types
if (response.status === 'success') {
    console.log('Success:', response.data);
} else {
    switch (response.error) {
        case 'connectionFailed':
            console.error('Could not connect to server');
            break;
        case 'timeout':
            console.error('Request timed out');
            break;
        case 'notFound':
            console.error('Resource not found (404)');
            break;
        case 'unauthorized':
            console.error('Authentication required');
            break;
        default:
            console.error('Other error:', response.error);
    }
}
```

## HTTP Methods

HttpClient supports all standard HTTP methods:

```typescript
// GET - Retrieve data
const getResponse = await client.get(url, options);

// POST - Create new resources
const postResponse = await client.post(url, { data: payload });

// PUT - Update/replace resources
const putResponse = await client.put(url, { data: payload });

// DELETE - Remove resources
const deleteResponse = await client.delete(url, options);

// PATCH - Partial updates
const patchResponse = await client.patch(url, { data: partialUpdate });

// HEAD - Get headers only
const headResponse = await client.head(url, options);

// OPTIONS - Get allowed methods
const optionsResponse = await client.options(url, options);
```

## Error Types

HttpClient uses human-readable error classifications:

### Network/Connection Errors
- `connectionFailed` - Cannot establish connection
- `timeout` - Request timed out
- `networkError` - General network issues

### HTTP Client Errors (4xx)
- `badRequest` - 400 Bad Request
- `unauthorized` - 401 Unauthorized
- `forbidden` - 403 Forbidden
- `notFound` - 404 Not Found
- `methodNotAllowed` - 405 Method Not Allowed
- `conflict` - 409 Conflict
- `unprocessableEntity` - 422 Unprocessable Entity
- `tooManyRequests` - 429 Too Many Requests

### HTTP Server Errors (5xx)
- `internalServerError` - 500 Internal Server Error
- `badGateway` - 502 Bad Gateway
- `serviceUnavailable` - 503 Service Unavailable
- `gatewayTimeout` - 504 Gateway Timeout

### Other
- `unknown` - Unclassified error
- `requestCancelled` - Request was cancelled

## Retry Logic

HttpClient implements sophisticated retry logic:

### Exponential Backoff
```
delay = baseDelay * (2 ^ (attempt - 1))
```

### Jitter (Anti-Thundering Herd)
```
finalDelay = delay + (delay * jitterFactor * random())
```

### Retryable vs Non-Retryable Errors

**Always Retried:**
- Network errors (`connectionFailed`, `networkError`)
- Timeout errors (`timeout`)
- Server errors (5xx status codes)
- Rate limiting (`tooManyRequests`)

**Never Retried:**
- Authentication errors (`unauthorized`, `forbidden`)
- Client errors (4xx except 429)
- Request cancellation

### Configuration Examples

```typescript
// Fast retries for quick-failing services
const fastClient = new HttpClient({
    retryCount: 5,
    retryDelay: 200,      // Start with 200ms
    maxRetryDelay: 2000,  // Cap at 2 seconds
    retryJitter: 0.3      // 30% jitter
});

// Slow retries for unreliable services
const slowClient = new HttpClient({
    retryCount: 3,
    retryDelay: 2000,     // Start with 2 seconds
    maxRetryDelay: 30000, // Cap at 30 seconds
    retryJitter: 0.1      // 10% jitter
});
```

## Logging

HttpClient supports comprehensive logging:

```typescript
const client = new HttpClient({
    logger: {
        debug: (msg) => console.log(`[DEBUG] ${msg}`),
        warn: (msg) => console.warn(`[WARN] ${msg}`),
        error: (msg) => console.error(`[ERROR] ${msg}`)
    }
});

// Enable debug logging for specific requests
const response = await client.get(url, { debug: true });
```

### Log Levels
- **DEBUG**: Request/response details, retry attempts
- **WARN**: Recoverable errors (timeouts, retries)
- **ERROR**: Non-recoverable errors, final failures

## Advanced Usage

### Custom User Agent

```typescript
const client = new HttpClient({
    userAgent: 'MyApp/1.0'
});

// Override for specific requests
const response = await client.get(url, {
    userAgent: 'MyApp/1.0 (Special Request)'
});
```

### SSL Validation

```typescript
// Disable SSL validation (not recommended for production)
const client = new HttpClient({
    validateSSL: false
});
```

### Redirect Handling

```typescript
const client = new HttpClient({
    maxRedirects: 10  // Allow up to 10 redirects
});
```

## Best Practices

### 1. Handle Errors Gracefully

```typescript
// Always check response status, never assume success
const response = await client.get(url);

if (response.status !== 'success') {
    // Handle error appropriately
    switch (response.error) {
        case 'unauthorized':
            // Refresh token and retry
            break;
        case 'notFound':
            // Resource doesn't exist
            break;
        case 'timeout':
        case 'connectionFailed':
            // Network issues - might be temporary
            break;
        default:
            // Other errors
            break;
    }
}
```

### 2. Configure Timeouts Appropriately

```typescript
// Fast APIs
const fastClient = new HttpClient({ timeout: 5000 });

// Slow APIs
const slowClient = new HttpClient({ timeout: 60000 });

// Very slow operations
const batchClient = new HttpClient({ timeout: 300000 }); // 5 minutes
```

### 3. Use Appropriate Retry Settings

```typescript
// Critical operations - more retries
const criticalClient = new HttpClient({
    retryCount: 5,
    retryDelay: 1000
});

// Background operations - fewer retries
const backgroundClient = new HttpClient({
    retryCount: 1,
    retryDelay: 5000
});
```

### 4. Log Appropriately

```typescript
// Enable debug logging in development
if (process.env.NODE_ENV === 'development') {
    client = new HttpClient({
        logger: console,
        // Other config
    });
}
```

## TypeScript Support

HttpClient is written in TypeScript and provides full type safety:

```typescript
import type {
    HttpClientConfig,
    RequestOptions,
    HttpClientResponse,
    HttpClientStatus,
    HttpClientErrorType
} from '@nmakarov/cli-toolkit/http-client';

const config: HttpClientConfig = {
    timeout: 10000,
    retryCount: 3
};

const options: RequestOptions = {
    headers: { 'Authorization': 'Bearer token' }
};

const response: HttpClientResponse = await client.get(url, options);

// Type-safe status checking
if (response.status === 'success') {
    // response.data is typed
    console.log(response.data);
}
```

## Migration from Legacy Code

### From XAxios

```typescript
// Legacy XAxios (throws exceptions)
try {
    const { data } = await xAxios.get(url, params);
    // Handle success
} catch (error) {
    // Handle error
}

// New HttpClient (never throws)
const response = await client.get(url, options);
if (response.status === 'success') {
    // Handle success
} else {
    // Handle error
}
```

### From Raw Axios

```typescript
// Raw axios (throws on HTTP errors)
try {
    const response = await axios.get(url, config);
    // Handle success
} catch (error) {
    // Handle error
}

// HttpClient (never throws)
const response = await client.get(url, options);
if (response.status === 'success') {
    // Handle success
} else {
    // Handle error
}
```

## Testing

HttpClient is designed to be easily testable:

```typescript
import { HttpClient } from '@nmakarov/cli-toolkit/http-client';

// Create client with custom logger for testing
const client = new HttpClient({
    logger: mockLogger,
    timeout: 1000  // Fast timeout for tests
});

// Mock responses in tests
// (axios is mocked internally in CI tests)
```

## Performance Considerations

- **Connection Pooling**: HttpClient reuses connections automatically
- **Timeout Management**: Prevents hanging requests
- **Retry Optimization**: Exponential backoff reduces server load
- **Memory Efficient**: Minimal memory footprint
- **Concurrent Requests**: Handle multiple requests simultaneously

## Troubleshooting

### Common Issues

1. **Requests Hanging**: Check timeout configuration
2. **Too Many Retries**: Adjust `retryCount` and `retryDelay`
3. **SSL Errors**: Set `validateSSL: false` for development (not recommended for production)
4. **Rate Limiting**: Implement backoff strategies for 429 responses

### Debug Mode

Enable debug logging to see detailed request/response information:

```typescript
const response = await client.get(url, { debug: true });
```

This will log:
- Request method, URL, and headers
- Request/response timing
- Retry attempts and delays
- Error details and classifications
