/**
 * Helper to load ESM-only modules in both CJS and ESM contexts
 * This allows the screen module to work with require() in CommonJS
 */

// Cache for loaded modules
const moduleCache = new Map();

/**
 * Dynamically import an ESM module, with caching
 * Works in both CommonJS (using dynamic import) and ESM contexts
 */
export async function loadESMModule(moduleName) {
    if (moduleCache.has(moduleName)) {
        return moduleCache.get(moduleName);
    }

    const module = await import(moduleName);
    moduleCache.set(moduleName, module);
    return module ;
}

/**
 * Synchronously get a cached module (for cases where it's already loaded)
 */
export function getCachedModule(moduleName) {
    return moduleCache.get(moduleName) || null;
}

