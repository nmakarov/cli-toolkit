/**
 * Tsup plugin to convert require() calls for ESM-only packages to lazy-loaded dynamic imports
 * This allows CommonJS builds to work with ESM-only dependencies like ink and react
 * 
 * The plugin creates lazy-loading proxies that use dynamic import() when first accessed
 */
export function esmDepsPlugin() {
  return {
    name: 'esm-deps',
    renderChunk(code, chunk, context) {
      // Only process CommonJS format and screen module
      // Check format by filename extension or context
      const isCJS = chunk?.fileName?.endsWith('.cjs') || context?.format === 'cjs';
      if (!isCJS || !chunk?.fileName?.includes('screen')) {
        return null;
      }

      // List of ESM-only packages that need dynamic imports
      const esmOnlyPackages = ['ink', 'react'];
      
      // Check if any ESM-only packages are being required
      const hasESMDeps = esmOnlyPackages.some(pkg => 
        code.includes(`require("${pkg}")`) || code.includes(`require('${pkg}')`)
      );
      
      if (!hasESMDeps) {
        return null;
      }

      // Create lazy-loading helper at the top
      const lazyLoader = `
var __esmCache = {};
var __loadESMSync = function(moduleName) {
  if (!__esmCache[moduleName]) {
    throw new Error(\`ESM module "\${moduleName}" must be loaded asynchronously. Use dynamic import() or ensure the module is loaded before use.\`);
  }
  return __esmCache[moduleName];
};
var __loadESMAsync = async function(moduleName) {
  if (__esmCache[moduleName]) return __esmCache[moduleName];
  const mod = await import(moduleName);
  __esmCache[moduleName] = mod;
  return mod;
};
// Pre-load ESM modules at module initialization
(async function() {
  try {
`;

      // Add pre-loading for each ESM package
      let preloadCode = '';
      for (const pkg of esmOnlyPackages) {
        if (code.includes(`require("${pkg}")`) || code.includes(`require('${pkg}')`)) {
          preloadCode += `    __esmCache["${pkg}"] = await import("${pkg}");\n`;
        }
      }

      const preloadEnd = `
  } catch (e) {
    // Module will be loaded on first access if pre-load fails
  }
})();
`;

      // Replace require() calls with cached module access
      let modified = code;
      for (const pkg of esmOnlyPackages) {
        // Pattern: var import_xxx = require("package");
        // More flexible pattern that matches any whitespace
        const requirePattern = new RegExp(
          `(var\\s+import_[\\w]+\\s*=\\s*)require\\(["']${pkg}["']\\)`,
          'g'
        );
        
        // Pattern: var import_xxx = __toESM(require("package"), 1);
        const requireToESMPattern = new RegExp(
          `(var\\s+import_[\\w]+\\s*=\\s*)__toESM\\(require\\(["']${pkg}["']\\),\\s*1\\)`,
          'g'
        );

        // Replace all occurrences
        modified = modified.replace(requirePattern, (match) => {
          // Extract the variable name and prefix
          const varMatch = match.match(/var\s+(import_\w+)\s*=\s*/);
          if (!varMatch) return match;
          return match.replace(`require("${pkg}")`, `__loadESMSync("${pkg}")`)
                     .replace(`require('${pkg}')`, `__loadESMSync("${pkg}")`);
        });

        modified = modified.replace(requireToESMPattern, (match) => {
          return match.replace(`require("${pkg}")`, `__loadESMSync("${pkg}")`)
                     .replace(`require('${pkg}')`, `__loadESMSync("${pkg}")`);
        });
      }
      
      // Debug: log if we made changes
      if (modified !== code) {
        console.log('[esm-deps plugin] Transformed screen.cjs');
      }

      // Insert the loader code after "use strict" or at the beginning
      const strictMatch = modified.match(/^("use strict";\s*\n)/);
      if (strictMatch) {
        modified = modified.replace(
          strictMatch[0],
          strictMatch[0] + lazyLoader + preloadCode + preloadEnd
        );
      } else {
        modified = lazyLoader + preloadCode + preloadEnd + modified;
      }

      return { code: modified, map: null };
    }
  };
}

