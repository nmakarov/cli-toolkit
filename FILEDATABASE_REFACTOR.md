# FileDatabase Refactor Plan

## Phase 1 Implementation Checklist

### 1. Configuration Updates ✅
- [x] Add `versioned?: boolean` to `FileDatabaseConfig` (default: true)
- [x] Update comments for `useMetadata` (auto-detected for reads)
- [x] Simplify `StorageMode` type

### 2. New Methods to Add

#### `getLatestVersion(): string | null`
```typescript
/**
 * Get the latest version (most recent timestamp)
 * Only works in versioned mode
 * @returns Latest version string or null if no versions
 */
getLatestVersion(): string | null {
    if (!this.config.versioned) {
        throw new FileDatabaseError("getLatestVersion() only works in versioned mode");
    }
    
    if (this.versions.length === 0) {
        return null;
    }
    
    return this.versions[this.versions.length - 1];
}
```

#### `hasData(): Promise<boolean>`
```typescript
/**
 * Check if any data exists in this table
 * Works for both versioned and non-versioned modes
 * @returns true if data exists
 */
async hasData(): Promise<boolean> {
    const tablePath = this.getDestinationPath();
    
    if (!fs.existsSync(tablePath)) {
        return false;
    }
    
    if (this.config.versioned) {
        // Check for version folders
        const versions = await this.getVersions();
        return versions.length > 0;
    } else {
        // Check for any data files or metadata
        const items = await fs.promises.readdir(tablePath);
        return items.some(item => 
            item === 'metadata.json' || 
            item.match(/^\d{6}\.(json|txt|xml)$/) ||
            item.endsWith('.json')
        );
    }
}
```

#### `detectDataFormat(): Promise<{versioned: boolean, hasMetadata: boolean}>`
```typescript
/**
 * Auto-detect the data format in this table
 * Used when reading existing data
 * @returns Format detection result
 */
async detectDataFormat(): Promise<{
    versioned: boolean;
    hasMetadata: boolean;
    dataType: DataType | null;
}> {
    const tablePath = this.getDestinationPath();
    
    if (!fs.existsSync(tablePath)) {
        return { versioned: false, hasMetadata: false, dataType: null };
    }
    
    const items = await fs.promises.readdir(tablePath);
    
    // Check for metadata.json in root (non-versioned with metadata)
    if (items.includes('metadata.json')) {
        const metadata = JSON.parse(
            await fs.promises.readFile(path.join(tablePath, 'metadata.json'), 'utf8')
        );
        return {
            versioned: false,
            hasMetadata: true,
            dataType: metadata.dataType || null
        };
    }
    
    // Check for version folders
    const versionFolders = items.filter(item => {
        const itemPath = path.join(tablePath, item);
        const stat = fs.statSync(itemPath);
        return stat.isDirectory() && isTimestampFolder(item);
    });
    
    if (versionFolders.length > 0) {
        // Check if latest version has metadata
        const latestVersion = versionFolders.sort().pop()!;
        const versionMetadataPath = path.join(tablePath, latestVersion, 'metadata.json');
        
        return {
            versioned: true,
            hasMetadata: fs.existsSync(versionMetadataPath),
            dataType: null
        };
    }
    
    // Check for sequential files (legacy non-versioned)
    const dataFiles = items.filter(f => f.match(/^\d{6}\.(json|txt|xml)$/));
    if (dataFiles.length > 0) {
        return {
            versioned: false,
            hasMetadata: false,
            dataType: null
        };
    }
    
    return { versioned: false, hasMetadata: false, dataType: null };
}
```

### 3. Updates to Existing Methods

#### Constructor
- Store `this.versioned = config.versioned ?? true`
- Auto-detect format if reading existing data

#### `prepare()`
- If `this.versioned === false` and reading:
  - Don't require version parameter
  - Set `this.currentVersion = null`
- Auto-detect `useMetadata` if not explicitly set

#### `read()`
- Make `version` optional - default to `getLatestVersion()` in versioned mode
- For non-versioned mode:
  - Read from table root directory
  - Still support pagination

#### `write()`
- In non-versioned mode:
  - Write to table root (no version folder)
  - Don't create new versions
  - Throw error if `forceNewVersion` is used

#### `makeNewVersion()`
- Only callable in versioned mode
- Throw error if `versioned === false`
- Reset metadata when called (as you noted)

#### `getVersions()`
- Return empty array if `versioned === false`
- Otherwise scan for timestamp folders

### 4. Path Resolution Updates

#### `getDestinationPath(version?: string)`
Current logic works for versioned mode. Update to:
```typescript
getDestinationPath(version?: string): string {
    let parts = [this.config.basePath];
    
    if (this.namespace) {
        parts.push(this.namespace);
    }
    
    if (this.tableName) {
        parts.push(...this.tableName.split('/'));
    }
    
    // Only add version folder if in versioned mode
    if (this.versioned && version) {
        parts.push(version);
    }
    
    return path.resolve(...parts);
}
```

### 5. Testing Scenarios

1. **Versioned with metadata (default)**
   - Write → creates version/000001.json + metadata.json
   - Read without version → uses latest automatically
   - forceNewVersion → resets metadata, creates new folder

2. **Versioned without metadata (legacy read)**
   - Auto-detect on read
   - Build metadata on-the-fly
   - getLatestVersion() works

3. **Non-versioned with metadata**
   - Write → creates 000001.json + metadata.json in root
   - Read → reads from root
   - No version folders created

4. **Non-versioned without metadata (legacy)**
   - Auto-detect on read
   - Build metadata on-the-fly
   - Read sequential files from root

### 6. Error Handling

Add clear error messages:
- "Cannot use forceNewVersion in non-versioned mode"
- "Cannot use version parameter in non-versioned mode"
- "getLatestVersion() only works in versioned mode"
- "No versions found - call write() first"

---

## Phase 2 (Future)

### File Metadata & Query Support
- Add `fileMetadata` to `FileEntry` type
- Store request URL, params, method, etc.
- Implement `query()` method for searching files
- Custom filename support (optional, auto-generated)

### Example:
```typescript
await store.write(loginResponse, {
    fileMetadata: {
        method: 'POST',
        url: '/api/login',
        params: { username: 'user@example.com' },
        operationId: 'login'
    },
    filename: 'login-response.json'  // optional
});

// Later: Query for specific response
const file = await store.query({
    method: 'POST',
    url: '/api/login',
    params: { username: 'user@example.com' }
});
```

---

## Migration Guide

### Existing Code (No Changes Needed)
```typescript
// Still works exactly the same (defaults to versioned: true)
const store = new FileDatabase({
    basePath: "./data",
    namespace: "harvested",
    tableName: "properties"
});
```

### New Non-Versioned Usage
```typescript
// Explicitly enable non-versioned mode
const store = new FileDatabase({
    basePath: "./data",
    namespace: "api-mocks",
    tableName: "user-service",
    versioned: false
});

// Writes go to root, no version folders
await store.write(data);
const all = await store.read();  // No version parameter needed
```

