# MockServer - HTTP Mock Server

A complete HTTP mock server with FileDatabase integration for API testing and development.

## Features

- 🚀 **Express-based HTTP Server**: Full-featured Express.js server with middleware support
- 💾 **FileDatabase Integration**: Uses FileDatabase for persistent mock response storage
- 🔍 **Request Matching**: Intelligent matching of incoming requests to stored responses
- 🔒 **Sensitive Data Masking**: Configurable masking of sensitive headers and data
- 📊 **Request/Response Capture**: Capture and store real API responses as mocks
- 🧹 **Maintenance & Cleanup**: Automatic cleanup of orphaned files and catalog entries
- 📈 **Statistics & Monitoring**: Real-time server statistics and request tracking
- 🎯 **Test Server Support**: Perfect for redirecting HttpClient requests during testing

## Installation

```bash
npm install @nmakarov/cli-toolkit
```

## Quick Start

```typescript
import { MockServer, createMockServer } from '@nmakarov/cli-toolkit/mock-server';
import { HttpClient } from '@nmakarov/cli-toolkit/http-client';

// Start mock server
const mockServer = new MockServer({
    basePath: './test-data',
    port: 5030,
    namespace: 'api-mocks',
    tableName: 'responses'
});

const server = await mockServer.start();
console.log(`Mock server running on port ${server.port}`);

// Use HttpClient with test server redirection
const client = new HttpClient({
    useTestServer: `http://localhost:${server.port}`
});

// Requests automatically redirected to mock server
const response = await client.get('https://api.example.com/users');
```

## Configuration

### MockServerConfig

```typescript
interface MockServerConfig {
    /** Base path for FileDatabase storage (required) */
    basePath: string;

    /** Server port (default: 5029) */
    port?: number;

    /** Namespace for mock data (default: "mocks") */
    namespace?: string;

    /** Table name for mock data (default: "responses") */
    tableName?: string;

    /** Sensitive keys to mask (default: common auth keys) */
    sensitiveKeys?: string[];

    /** Logger instance */
    logger?: any;

    /** Enable debug logging (default: false) */
    debug?: boolean;

    /** Custom Express middleware */
    middleware?: Array<(req: any, res: any, next: any) => void>;
}
```

## Usage Examples

### Starting a Mock Server

```typescript
const mockServer = new MockServer({
    basePath: './mocks',
    port: 5030,
    sensitiveKeys: ['authorization', 'api_key', 'password']
});

const server = await mockServer.start();
console.log(`Server running on port ${server.port}`);

// Later...
await server.close();
```

### Using the Convenience Function

```typescript
import { createMockServer } from '@nmakarov/cli-toolkit/mock-server';

const server = await createMockServer({
    basePath: './test-mocks',
    port: 5040
});

// Server automatically started
console.log(`Server: ${server.port}`);

// Cleanup
await server.close();
```

### Capturing Mock Responses

```typescript
// Capture a response from a real API call
const response = await mockServer.storeMock(
    'https://api.example.com/users/123',
    null, // GET request, no body
    {
        status: 200,
        headers: { 'content-type': 'application/json' },
        data: { id: 123, name: 'John Doe', email: 'john@example.com' }
    },
    'getUser',           // Operation ID for precise matching
    'Get User Profile'   // Human-readable name
);
```

### HttpClient Integration

```typescript
// Configure HttpClient to use mock server
const client = new HttpClient({
    timeout: 5000,
    useTestServer: 'http://localhost:5030'  // Redirect to mock server
});

// This request goes to mock server instead of real API
const response = await client.get('https://api.example.com/users/123');

// XAXIOSOrigin header automatically set to original URL
// Mock server matches request and returns stored response
```

## Request Matching

MockServer uses intelligent request matching to find appropriate mock responses:

### Exact Matching
1. **Method**: HTTP method must match (GET, POST, etc.)
2. **Host**: Domain/host must match
3. **Path**: URL path must match exactly
4. **Query**: Query parameters must match (order-independent)
5. **Body**: Request body must match for POST/PUT/PATCH

### Fuzzy Matching (Fallback)
If exact match fails, MockServer tries fuzzy matching by ignoring common parameters:
- `timestamp`, `nonce`, `cache`, `_` (and other configurable ignore patterns)

### Operation ID Matching
For precise control, use operation IDs:

```typescript
// Store with operation ID
await mockServer.storeMock(url, data, response, 'getUserById');

// Match by operation ID first, then fall back to URL matching
```

## Sensitive Data Handling

MockServer automatically masks sensitive data to prevent accidental exposure:

### Default Sensitive Keys
- `client_id`, `client_secret`, `access_token`
- `authorization`, `bearer`, `api_key`, `apikey`
- `password`, `token`

### Custom Sensitive Keys

```typescript
const server = new MockServer({
    basePath: './mocks',
    sensitiveKeys: ['my_custom_token', 'secret_key', 'internal_api_key']
});
```

### How Masking Works

```typescript
// Original data
{
    authorization: "Bearer eyJhbGciOiJIUzI1NiIs...",
    api_key: "sk-1234567890abcdef",
    user: "john_doe"
}

// Stored as
{
    authorization: "[md5:8f5c9b7a3e2d1f0c...]",
    api_key: "[md5:a1b2c3d4e5f6g7h8...]",
    user: "john_doe"
}
```

**Note**: Original values are NOT stored - only MD5 hashes for matching purposes.

## Built-in Endpoints

MockServer provides several built-in endpoints for testing:

### Version Information
```
GET /version
```
Returns server version and status.

### Error Simulation
```
GET /404
```
Returns a 404 Not Found response.

### Test Endpoint
```
GET /test
```
Supports various testing scenarios:

```bash
# Add delay
curl "http://localhost:5030/test" -H "x-axios-delay: 1000"

# Simulate HTTP errors
curl "http://localhost:5030/test" -H "x-axios-err: 500"

# Simulate connection reset
curl "http://localhost:5030/test" -H "x-axios-err: econnreset"
```

### Catch-All Handler
```
ANY /*
```
Matches all other requests against stored mocks using the `XAXIOSOrigin` header.

## FileDatabase Integration

MockServer uses FileDatabase for persistent storage:

### Storage Structure
```
basePath/
├── namespace/
│   └── tableName/
│       ├── catalog/          # Mock catalog entries
│       │   ├── entry1.json
│       │   ├── entry2.json
│       │   └── ...
│       └── responses/        # Response data
│           ├── response1.json
│           ├── response2.json
│           └── ...
```

### Catalog Entries
Each mock has a catalog entry with metadata:

```typescript
interface MockResponseEntry {
    method: string;           // HTTP method
    host: string;            // Original host
    pathname: string;        // URL path
    query: string;           // Sanitized query string
    file: string;            // Response data filename
    timestamp: string;       // When mock was created
    requestData?: any;       // Sanitized request data
    operationId?: string;    // Operation identifier
    mockName?: string;       // Human-readable name
}
```

## Management & Maintenance

### Listing Stored Mocks

```typescript
const mocks = await mockServer.listMocks();
console.log(`Total mocks: ${mocks.length}`);

mocks.forEach(mock => {
    console.log(`${mock.method} ${mock.host}${mock.pathname} -> ${mock.file}`);
});
```

### Removing Mocks

```typescript
const success = await mockServer.removeMock('mock_filename');
if (success) {
    console.log('Mock removed successfully');
}
```

### Maintenance Cleanup

```typescript
// Clean up orphaned files and catalog entries
const result = await mockServer.maintenance();
console.log(`Cleaned up ${result.cleaned} orphaned files`);
```

### Server Statistics

```typescript
const stats = mockServer.getStats();
console.log(`Requests: ${stats.totalRequests}`);
console.log(`Mock responses: ${stats.mockResponses}`);
console.log(`Fallback responses: ${stats.fallbackResponses}`);
console.log(`Errors: ${stats.errors}`);
console.log(`Uptime: ${stats.uptime}ms`);
```

## Advanced Configuration

### Custom Middleware

```typescript
const server = new MockServer({
    basePath: './mocks',
    middleware: [
        (req, res, next) => {
            console.log(`Request: ${req.method} ${req.url}`);
            next();
        },
        // Add authentication, logging, etc.
    ]
});
```

### Custom Logger

```typescript
const server = new MockServer({
    basePath: './mocks',
    logger: {
        debug: (msg) => customLogger.debug(msg),
        warn: (msg) => customLogger.warn(msg),
        error: (msg) => customLogger.error(msg)
    }
});
```

### Debug Mode

```typescript
const server = new MockServer({
    basePath: './mocks',
    debug: true  // Enable detailed request/response logging
});
```

## Integration Patterns

### Development Workflow

```typescript
// 1. Start mock server
const mockServer = await createMockServer({
    basePath: './dev-mocks',
    port: 5030
});

// 2. Capture responses from real API
const realResponse = await realApiClient.get('/users');
await mockServer.storeMock(
    'https://api.example.com/users',
    null,
    realResponse,
    'listUsers'
);

// 3. Use in tests
const testClient = new HttpClient({
    useTestServer: 'http://localhost:5030'
});
// All requests now use stored mocks
```

### CI/CD Integration

```typescript
// Load pre-captured mocks for CI
const mockServer = await createMockServer({
    basePath: './ci-mocks',  // Pre-populated with test data
    port: 5030
});

// Run tests against mock server
// No external API dependencies
```

### API Contract Testing

```typescript
// Capture current API responses as contract
const contractServer = await createMockServer({
    basePath: './api-contract',
    port: 5030
});

// After API changes, compare against stored contract
// Ensures backward compatibility
```

## Best Practices

### 1. Use Operation IDs for Critical APIs

```typescript
// Use operation IDs for APIs that change frequently
await mockServer.storeMock(url, data, response, 'getUserProfile.v1');
// Easy to update when API changes
```

### 2. Organize Mocks by Environment

```typescript
const devServer = new MockServer({
    basePath: './mocks/dev',
    namespace: 'development'
});

const stagingServer = new MockServer({
    basePath: './mocks/staging',
    namespace: 'staging'
});
```

### 3. Regular Maintenance

```typescript
// Run maintenance weekly to clean up old/unused mocks
const result = await mockServer.maintenance();
if (result.cleaned > 0) {
    console.log(`Cleaned ${result.cleaned} orphaned files`);
}
```

### 4. Monitor Server Health

```typescript
// Check server stats periodically
const stats = mockServer.getStats();
const errorRate = stats.errors / stats.totalRequests;

if (errorRate > 0.1) { // 10% error rate
    console.warn('High error rate detected');
}
```

### 5. Backup Important Mocks

```typescript
// Important mocks should be version controlled
const criticalMocks = await mockServer.listMocks();
// Backup to version control or external storage
```

## Troubleshooting

### Common Issues

1. **Port Already in Use**
   ```typescript
   // Try different port
   const server = await createMockServer({
       basePath: './mocks',
       port: 5031  // Try 5031, 5032, etc.
   });
   ```

2. **No Mock Response Found**
   - Check that `XAXIOSOrigin` header is set by HttpClient
   - Verify request URL matches stored mock exactly
   - Use operation IDs for precise matching

3. **Permission Errors**
   - Ensure write access to `basePath`
   - Check file system permissions

4. **Memory Issues with Large Mocks**
   - Use pagination when listing large numbers of mocks
   - Run maintenance regularly to clean up orphaned files

### Debug Mode

Enable debug logging to see detailed request processing:

```typescript
const server = new MockServer({
    basePath: './mocks',
    debug: true
});
// Logs all requests, matches, and responses
```

### Health Checks

```typescript
// Test server health
const response = await fetch('http://localhost:5030/version');
if (response.ok) {
    console.log('Server is healthy');
}
```

## Migration from Legacy MockEngine

### Key Differences

**Legacy MockEngine:**
- Custom file-based storage
- Manual catalog management
- Hard-coded sensitive keys

**New MockServer:**
- FileDatabase integration
- Automatic catalog management
- Configurable sensitive keys
- Express.js server with full middleware support

### Migration Path

```typescript
// Legacy
const mockEngine = new MockEngine({
    mocksPath: './mocks'
});

// New
const mockServer = new MockServer({
    basePath: './mocks',
    sensitiveKeys: ['custom_key1', 'custom_key2']
});
```

### Data Migration

Legacy mock files can be imported using the maintenance and storeMock methods:

```typescript
// Import legacy mocks
const legacyMocks = loadLegacyMocks('./old-mocks');
for (const mock of legacyMocks) {
    await mockServer.storeMock(
        mock.url,
        mock.requestData,
        mock.response,
        mock.operationId,
        mock.name
    );
}
```

## TypeScript Support

MockServer provides full TypeScript support:

```typescript
import type {
    MockServerConfig,
    MockServerInstance,
    MockResponseEntry,
    MockResponseData,
    ServerStats
} from '@nmakarov/cli-toolkit/mock-server';

// Fully typed
const config: MockServerConfig = {
    basePath: './mocks',
    port: 5030
};

const server: MockServerInstance = await createMockServer(config);
const stats: ServerStats = server.getStats();
```

## Performance Considerations

- **File I/O**: FileDatabase operations are synchronous but fast
- **Memory Usage**: Minimal memory footprint for server operation
- **Concurrent Requests**: Handles multiple simultaneous requests
- **Storage Growth**: Monitor disk usage for large mock collections
- **Cleanup**: Regular maintenance prevents storage bloat

## Security Considerations

- **Sensitive Data**: Never stores original sensitive values
- **Access Control**: Consider adding authentication middleware for production
- **Data Exposure**: Mocks may contain sensitive test data
- **Network Security**: Use HTTPS in production environments
- **File Permissions**: Restrict access to mock data files

This provides a complete HTTP mock server solution with FileDatabase integration, replacing the legacy MockEngine with modern, maintainable code.
