# FileDatabase - Structured File Storage

A comprehensive file-based data storage system with versioning, chunking, pagination, and legacy compatibility.

## Features

- 📁 **Dual Storage Modes**: Versioned (timestamped folders) and non-versioned (direct files)
- 📄 **Multiple Data Types**: JSON arrays/objects, text files, XML documents
- 📊 **Automatic Chunking**: Splits large datasets into manageable files
- 📖 **Pagination Support**: Efficient reading of large datasets
- 🔄 **Legacy Compatibility**: Reads existing data structures automatically
- 📈 **Custom Synopsis**: Data analysis and statistics functions
- 🔍 **Metadata Management**: Automatic generation and optimization
- 🛡️ **TypeScript First**: Full type safety with comprehensive interfaces

## Installation

```bash
npm install @nmakarov/cli-toolkit
```

## Quick Start

```typescript
import { FileDatabase } from '@nmakarov/cli-toolkit/filedatabase';

// Versioned storage (default) - creates timestamped folders
const db = new FileDatabase({
    basePath: './data',
    namespace: 'api',
    tableName: 'responses'
});

await db.write([{ id: 1, name: 'Item 1' }, { id: 2, name: 'Item 2' }]);
const data = await db.read(); // Auto-detects latest version

// Non-versioned storage - for single objects
const db2 = new FileDatabase({
    basePath: './data',
    namespace: 'cache',
    tableName: 'user-profile',
    versioned: false
});

await db2.write({ id: 123, name: 'John Doe' });
const profile = await db2.read();
```

## Configuration

### FileDatabaseConfig

```typescript
interface FileDatabaseConfig {
    /** Base path for all file storage (required) */
    basePath: string;

    /** Namespace subfolder (default: "default") */
    namespace?: string;

    /** Table/collection name (optional) */
    tableName?: string;

    /** Storage mode (default: true for versioned) */
    versioned?: boolean;

    /** Max versions to keep (versioned mode only, default: 5) */
    maxVersions?: number;

    /** Records per file for chunking (default: 5000) */
    pageSize?: number;

    /** Use metadata.json files (default: true) */
    useMetadata?: boolean;

    /** Free disk space threshold (default: 100MB) */
    freeSpaceThreshold?: number;

    /** Logger instance */
    logger?: any;
}
```

## Storage Modes

### Versioned Mode (Default)

Creates timestamped folders for data versioning:

```
data/
├── api/
│   └── responses/
│       ├── 2025-11-09T10:30:45Z/
│       │   ├── 000001.json (first chunk)
│       │   ├── 000002.json (second chunk)
│       │   └── metadata.json
│       └── 2025-11-09T10:35:12Z/ (newer version)
│           ├── 000001.json
│           └── metadata.json
```

**Use Case**: Data that changes over time and needs historical versions.

### Non-Versioned Mode

Stores files directly in the table folder:

```
data/
├── cache/
│   └── user-profile/
│       ├── 000001.json (single file)
│       └── metadata.json
```

**Use Case**: Single objects or data that doesn't need versioning.

## Usage Examples

### Basic Write/Read

```typescript
const db = new FileDatabase({
    basePath: './data',
    namespace: 'ecommerce',
    tableName: 'products'
});

// Write data (automatically chunked if large)
const products = Array.from({ length: 10000 }, (_, i) => ({
    id: i + 1,
    name: `Product ${i + 1}`,
    price: Math.random() * 100,
    category: ['electronics', 'books', 'clothing'][i % 3]
}));

await db.write(products);

// Read all data
const allProducts = await db.read();

// Read with pagination
let page = 0;
let productsPage;
do {
    productsPage = await db.read({
        nextPage: true,
        pageSize: 1000
    });
    console.log(`Page ${page}: ${productsPage.length} products`);
    page++;
} while (productsPage.length > 0);
```

### Version Management

```typescript
// Create new version
await db.write(newProducts, { forceNewVersion: true });

// Get latest version
const latestVersion = await db.getLatestVersion();

// Read specific version
const oldProducts = await db.read({ version: '2025-11-09T10:30:45Z' });

// List all versions
const versions = await db.getVersions();
console.log('Available versions:', versions);
```

### Non-Versioned Storage

```typescript
const db = new FileDatabase({
    basePath: './data',
    namespace: 'config',
    tableName: 'app-settings',
    versioned: false  // Direct file storage
});

// Store single object
await db.write({
    theme: 'dark',
    language: 'en',
    notifications: true,
    apiUrl: 'https://api.example.com'
});

// Read single object
const settings = await db.read();
```

### Legacy Data Reading

```typescript
// Automatically detects and reads existing data structures
const db = new FileDatabase({
    basePath: './legacy-data',
    namespace: 'old-system',
    tableName: 'records'
});

// Reads existing files even without metadata.json
const legacyData = await db.read();
```

## Data Types

FileDatabase supports multiple data formats:

### JSON Arrays (Default)

```typescript
const data = [
    { id: 1, name: 'Item 1' },
    { id: 2, name: 'Item 2' }
];
await db.write(data);
```

### JSON Objects

```typescript
const data = {
    id: 123,
    name: 'Single Item',
    metadata: { created: new Date() }
};
await db.write(data);
```

### Text Files

```typescript
const data = "This is plain text content";
await db.write(data);
```

### XML Documents

```typescript
const data = `<?xml version="1.0"?>
<root>
    <item id="1">Content 1</item>
    <item id="2">Content 2</item>
</root>`;
await db.write(data);
```

## Chunking and Pagination

### Automatic Chunking

Large datasets are automatically split into chunks:

```typescript
const db = new FileDatabase({
    basePath: './data',
    namespace: 'large-dataset',
    tableName: 'records',
    pageSize: 1000  // 1000 records per file
});

const largeDataset = Array.from({ length: 5000 }, (_, i) => ({
    id: i + 1,
    data: `Record ${i + 1}`
}));

await db.write(largeDataset);
// Creates: 000001.json (1000 records), 000002.json (1000 records), etc.
```

### Reading with Pagination

```typescript
// Read all data at once (for small datasets)
const allData = await db.read();

// Read with pagination (for large datasets)
const pageSize = 500;
let hasMore = true;
let page = 0;

while (hasMore) {
    const pageData = await db.read({
        nextPage: true,
        pageSize: pageSize
    });

    if (pageData.length === 0) {
        hasMore = false;
    } else {
        console.log(`Processing page ${page}: ${pageData.length} records`);
        // Process pageData...
        page++;
    }
}
```

### Cursor-Based Reading

```typescript
// Start reading from the beginning
db.setStartRecord(0);

// Read first page
let page1 = await db.read({ nextPage: true, pageSize: 100 });

// Continue reading (cursor automatically advances)
let page2 = await db.read({ nextPage: true, pageSize: 100 });

// Reset cursor for fresh read
db.setStartRecord(0);
let freshRead = await db.read({ nextPage: true, pageSize: 100 });
```

## Metadata and Synopsis

### Automatic Metadata

FileDatabase automatically generates metadata:

```typescript
await db.write(products);

// Metadata includes:
// - totalRecords: Total number of records
// - dataType: 'json-array', 'json-object', 'text', or 'xml'
// - createdAt/modifiedAt: Timestamps
// - files: Array of file entries with record counts
// - synopsis: Custom analysis data (if configured)
```

### Custom Synopsis Functions

Add data analysis functions:

```typescript
const db = new FileDatabase({
    basePath: './data',
    namespace: 'analytics',
    tableName: 'sales'
});

// Add synopsis function for file-level analysis
db.setFileSynopsisFunction((fileEntry, data) => ({
    ...fileEntry,
    recordCount: Array.isArray(data) ? data.length : 1,
    averageValue: Array.isArray(data)
        ? data.reduce((sum, item) => sum + (item.value || 0), 0) / data.length
        : data.value || 0
}));

// Add synopsis function for version-level analysis
db.setVersionSynopsisFunction((metadata) => ({
    ...metadata,
    totalValue: metadata.files.reduce((sum, file) =>
        sum + (file.averageValue || 0) * (file.recordCount || 0), 0),
    fileCount: metadata.files.length,
    averageRecordsPerFile: metadata.totalRecords / metadata.files.length
}));

await db.write(salesData);
const metadata = db.getMetadata();
console.log('Total sales value:', metadata.synopsis.totalValue);
```

## Legacy Compatibility

### Reading Existing Data

FileDatabase automatically detects and reads existing data structures:

```typescript
// Reads data created by other systems
const db = new FileDatabase({
    basePath: './existing-data',
    namespace: 'old-system',
    tableName: 'records'
});

// Automatically detects:
// - Versioned vs non-versioned structure
// - Presence of metadata.json
// - Data types and formats
// - File chunking patterns

const data = await db.read(); // Works regardless of original format
```

### Optimized Legacy Reading

For large legacy datasets without metadata:

```typescript
// Only reads first and last files to calculate totals
// Much faster than reading all files for metadata generation
const data = await db.read({ useOptimizedMetadata: true });
```

## Error Handling

FileDatabase operations may throw `FileDatabaseError`:

```typescript
import { FileDatabase, FileDatabaseError } from '@nmakarov/cli-toolkit/filedatabase';

try {
    await db.write(data);
} catch (error) {
    if (error instanceof FileDatabaseError) {
        console.error('FileDatabase error:', error.message);
    } else {
        console.error('Unexpected error:', error);
    }
}
```

## Advanced Configuration

### Custom Page Sizes

```typescript
const db = new FileDatabase({
    basePath: './data',
    namespace: 'big-data',
    tableName: 'dataset',
    pageSize: 10000  // Larger chunks for better performance
});
```

### Version Management

```typescript
const db = new FileDatabase({
    basePath: './data',
    namespace: 'versioned-data',
    tableName: 'documents',
    maxVersions: 10  // Keep last 10 versions
});

// Force new version
await db.write(newData, { forceNewVersion: true });

// Clean up old versions automatically
// (happens during write operations)
```

### Disk Space Monitoring

```typescript
const db = new FileDatabase({
    basePath: './data',
    namespace: 'large-files',
    tableName: 'media',
    freeSpaceThreshold: 1024 * 1024 * 1024  // 1GB minimum free space
});

// Throws error if insufficient disk space
await db.write(largeData);
```

## Best Practices

### 1. Choose Storage Mode Wisely

```typescript
// Use versioned for data that changes over time
const historicalData = new FileDatabase({
    basePath: './data',
    namespace: 'historical',
    tableName: 'prices',
    versioned: true  // Track price changes over time
});

// Use non-versioned for static configuration
const config = new FileDatabase({
    basePath: './data',
    namespace: 'config',
    tableName: 'settings',
    versioned: false  // Single current configuration
});
```

### 2. Optimize for Your Use Case

```typescript
// Fast random access - smaller page sizes
const randomAccess = new FileDatabase({
    basePath: './data',
    namespace: 'random',
    tableName: 'items',
    pageSize: 100
});

// Bulk processing - larger page sizes
const bulkProcessing = new FileDatabase({
    basePath: './data',
    namespace: 'bulk',
    tableName: 'logs',
    pageSize: 50000
});
```

### 3. Use Appropriate Versioning

```typescript
// Frequent small changes - fewer versions
const frequentUpdates = new FileDatabase({
    basePath: './data',
    namespace: 'frequent',
    tableName: 'status',
    maxVersions: 3
});

// Important milestones - more versions
const importantVersions = new FileDatabase({
    basePath: './data',
    namespace: 'milestones',
    tableName: 'releases',
    maxVersions: 50
});
```

### 4. Handle Large Datasets

```typescript
// Always use pagination for large datasets
const db = new FileDatabase({
    basePath: './data',
    namespace: 'big-data',
    tableName: 'analytics'
});

// Process in chunks to avoid memory issues
let processed = 0;
let page;
do {
    page = await db.read({
        nextPage: true,
        pageSize: 10000
    });

    // Process page...
    processed += page.length;
    console.log(`Processed ${processed} records`);
} while (page.length > 0);
```

## TypeScript Support

FileDatabase provides comprehensive TypeScript support:

```typescript
import type {
    FileDatabaseConfig,
    VersionMetadata,
    FileEntry,
    ReadOptions,
    WriteOptions,
    DataType
} from '@nmakarov/cli-toolkit/filedatabase';

// Fully typed configuration
const config: FileDatabaseConfig = {
    basePath: './data',
    namespace: 'typed',
    tableName: 'data'
};

const db = new FileDatabase(config);

// Typed metadata access
const metadata: VersionMetadata = db.getMetadata();
const files: FileEntry[] = metadata.files;

// Type-safe data types
const dataType: DataType = metadata.dataType; // 'json-array' | 'json-object' | 'text' | 'xml'
```

## Performance Considerations

### Memory Usage
- **Pagination**: Read large datasets in chunks to avoid memory exhaustion
- **Synopsis Functions**: Be mindful of memory usage in analysis functions
- **Chunking**: Balance between too many small files vs large files

### Disk I/O
- **Versioned Mode**: More directories but cleaner organization
- **Non-Versioned Mode**: Fewer directories but less history
- **Metadata Optimization**: Reduces I/O for large legacy datasets

### File System Limits
- **File Count**: Too many small files can slow directory operations
- **Path Length**: Keep basePath reasonably short
- **Disk Space**: Monitor free space for large datasets

## Migration Guide

### From Legacy File Storage

```typescript
// Legacy approach
const fs = require('fs');
const path = require('path');

function saveData(data, filePath) {
    fs.writeFileSync(filePath, JSON.stringify(data));
}

function loadData(filePath) {
    return JSON.parse(fs.readFileSync(filePath));
}

// FileDatabase approach
import { FileDatabase } from '@nmakarov/cli-toolkit/filedatabase';

const db = new FileDatabase({
    basePath: './data',
    namespace: 'app',
    tableName: 'items'
});

// Automatic chunking, versioning, metadata
await db.write(data);
const loaded = await db.read();
```

### From Database Systems

```typescript
// Traditional database
await db.query('INSERT INTO items VALUES ?', [items]);
const results = await db.query('SELECT * FROM items');

// FileDatabase approach
await db.write(items);
const results = await db.read();

// With versioning
await db.write(updatedItems, { forceNewVersion: true });
const history = await db.read({ version: '2025-11-09T10:30:45Z' });
```

## Testing

FileDatabase is designed for easy testing:

```typescript
import { FileDatabase } from '@nmakarov/cli-toolkit/filedatabase';
import { tmpdir } from 'os';
import { join } from 'path';

// Use temporary directory for tests
const testDb = new FileDatabase({
    basePath: join(tmpdir(), 'filedatabase-test'),
    namespace: 'test',
    tableName: 'data'
});

// Tests automatically clean up temp files
```

## Troubleshooting

### Common Issues

1. **Permission Errors**: Ensure write access to basePath
2. **Disk Full**: Check freeSpaceThreshold configuration
3. **Memory Issues**: Use pagination for large datasets
4. **Slow Reads**: Enable metadata optimization for legacy data

### Debug Mode

Enable detailed logging:

```typescript
const db = new FileDatabase({
    basePath: './data',
    namespace: 'debug',
    tableName: 'test',
    logger: console
});
```

### Performance Monitoring

```typescript
// Check data size and structure
const hasData = await db.hasData();
const versions = await db.getVersions();
const metadata = db.getMetadata();

console.log('Has data:', hasData);
console.log('Versions:', versions.length);
console.log('Total records:', metadata.totalRecords);
console.log('File count:', metadata.files.length);
```
