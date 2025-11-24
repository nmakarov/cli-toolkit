#!/usr/bin/env node
/**
 * Post-build script to fix ESM-only dependencies in CJS builds
 * Converts require() calls for ink and react to use dynamic imports
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const distDir = join(process.cwd(), 'dist');

// Fix both screen.cjs and index.cjs
const filesToFix = [
  { fileName: 'screen.cjs', exportsVar: 'screen_exports' },
  { fileName: 'index.cjs', exportsVar: 'src_exports' }
];

for (const { fileName, exportsVar } of filesToFix) {
  const filePath = join(distDir, fileName);
  
  try {
    console.log(`Fixing ESM dependencies in ${fileName}...`);
    
    let code = readFileSync(filePath, 'utf-8');

    // Check if already transformed
    if (code.includes('__esmCache')) {
      console.log(`${fileName} already transformed, skipping`);
      continue;
    }

    // Create the ESM loader code
    const loaderCode = `
var __esmCache = {};
var __loadESMSync = function(moduleName) {
  if (!__esmCache[moduleName]) {
    throw new Error(\`ESM module "\${moduleName}" not loaded. Please call the load() function first: const toolkit = require("@nmakarov/cli-toolkit"); await toolkit.load();\`);
  }
  return __esmCache[moduleName];
};
`;

    // Insert loader after "use strict"
    code = code.replace(/^("use strict";\s*\n)/, `$1${loaderCode}`);

    // Find all import variable declarations that use require() for react or ink
    // We'll replace them with null initially, then load() will set them
    const importVars = [];
    const reactPattern = /var\s+(import_\w+)\s*=\s*(__toESM\(require\(["']react["']\),\s*1\)|require\(["']react["']\))/g;
    const inkPattern = /var\s+(import_\w+)\s*=\s*require\(["']ink["']\)/g;

    let match;
    while ((match = reactPattern.exec(code)) !== null) {
      importVars.push({ name: match[1], type: 'react', isToESM: match[2].includes('__toESM') });
    }
    while ((match = inkPattern.exec(code)) !== null) {
      importVars.push({ name: match[1], type: 'ink', isToESM: false });
    }

    // Replace all require() calls with null assignments
    code = code.replace(/var\s+(import_\w+)\s*=\s*__toESM\(require\(["']react["']\),\s*1\)/g, 
      'var $1 = null; // Will be set by load()');
    code = code.replace(/var\s+(import_\w+)\s*=\s*require\(["']react["']\)/g, 
      'var $1 = null; // Will be set by load()');
    code = code.replace(/var\s+(import_\w+)\s*=\s*require\(["']ink["']\)/g, 
      'var $1 = null; // Will be set by load()');

    // Find and update the load() function to set all these variables
    const loadFunctionMatch = code.match(/async\s+function\s+load\(\)\s*\{[\s\S]*?\n\}/);
    if (loadFunctionMatch) {
      // Build the variable assignments for load()
      const reactVars = importVars.filter(v => v.type === 'react');
      const inkVars = importVars.filter(v => v.type === 'ink');
      
      const loadAssignments = [];
      if (reactVars.length > 0) {
        loadAssignments.push(`    var reactMod = await import("react");`);
        loadAssignments.push(`    __esmCache["react"] = reactMod;`);
        reactVars.forEach(v => {
          if (v.isToESM) {
            loadAssignments.push(`    ${v.name} = __toESM(reactMod, 1);`);
          } else {
            loadAssignments.push(`    ${v.name} = reactMod;`);
          }
        });
      }
      if (inkVars.length > 0) {
        loadAssignments.push(`    var inkMod = await import("ink");`);
        loadAssignments.push(`    __esmCache["ink"] = inkMod;`);
        inkVars.forEach(v => {
          loadAssignments.push(`    ${v.name} = inkMod;`);
        });
      }
      
      const newLoadFunction = `async function load() {
  if (loadPromise) return loadPromise;
${loadAssignments.join('\n')}
  loadPromise = Promise.resolve();
  return loadPromise;
}`;
      
      code = code.replace(/async\s+function\s+load\(\)\s*\{[\s\S]*?\n\}/, newLoadFunction);
    } else {
      // If load() doesn't exist, add it
      const reactVars = importVars.filter(v => v.type === 'react');
      const inkVars = importVars.filter(v => v.type === 'ink');
      
      const loadAssignments = [];
      if (reactVars.length > 0) {
        loadAssignments.push(`    var reactMod = await import("react");`);
        loadAssignments.push(`    __esmCache["react"] = reactMod;`);
        reactVars.forEach(v => {
          if (v.isToESM) {
            loadAssignments.push(`    ${v.name} = __toESM(reactMod, 1);`);
          } else {
            loadAssignments.push(`    ${v.name} = reactMod;`);
          }
        });
      }
      if (inkVars.length > 0) {
        loadAssignments.push(`    var inkMod = await import("ink");`);
        loadAssignments.push(`    __esmCache["ink"] = inkMod;`);
        inkVars.forEach(v => {
          loadAssignments.push(`    ${v.name} = inkMod;`);
        });
      }
      
      const loadFunction = `
var loadPromise = null;
async function load() {
  if (loadPromise) return loadPromise;
${loadAssignments.join('\n')}
  loadPromise = Promise.resolve();
  return loadPromise;
}
`;
      
      // Insert before module.exports
      const moduleExportsPattern = new RegExp(`(module\\.exports = __toCommonJS\\(${exportsVar}\\);)`, 'g');
      if (code.match(moduleExportsPattern)) {
        code = code.replace(moduleExportsPattern, `${loadFunction}\n$1`);
      } else {
        // Fallback: insert before any module.exports
        code = code.replace(/(module\.exports\s*=)/, `${loadFunction}\n$1`);
      }
    }

    // Remove intermediate variable assignments that use import variables
    // These execute immediately and cause errors during module load
    code = code.split('\n').map(line => {
      // Check if this line has the problematic pattern
      if (line.includes('var ') && line.includes('import_') && line.includes('Object.defineProperty') && line.includes('createElement')) {
        return '// Removed: intermediate assignment that would execute during module load';
      }
      // Also check for simple assignments
      if (/var\s+\w+\s*=\s*import_\w+\.\w+;/.test(line)) {
        return '// Removed: intermediate assignment - code will access import variable directly';
      }
      return line;
    }).join('\n');

    // Update exports to include load function and init function
    const exportPattern = new RegExp(`(__export\\(${exportsVar}, \\{)`, 'g');
    if (code.match(exportPattern)) {
      // Check if load is already in exports
      if (!code.includes(`load: () => load`)) {
        code = code.replace(
          exportPattern,
          `$1\n  load: () => load,`
        );
      }
      // Check if init is already in exports (for index.cjs)
      if (fileName === 'index.cjs' && !code.includes(`init: () => init`)) {
        // Check if init function exists in the code
        if (code.includes('async function init(') || code.includes('function init(')) {
          code = code.replace(
            exportPattern,
            `$1\n  init: () => init,`
          );
        }
      }
    } else {
      // If __export pattern doesn't exist, try module.exports pattern
      if (code.includes('module.exports')) {
        // Add load to exports if not already there
        if (!code.includes(`load:`)) {
          code = code.replace(
            /(module\.exports\s*=\s*\{)/,
            `$1\n  load: () => load,`
          );
        }
        // Add init to exports if not already there (for index.cjs)
        if (fileName === 'index.cjs' && !code.includes(`init:`)) {
          if (code.includes('async function init(') || code.includes('function init(')) {
            code = code.replace(
              /(module\.exports\s*=\s*\{)/,
              `$1\n  init: () => init,`
            );
          }
        }
      }
    }

    writeFileSync(filePath, code, 'utf-8');
    console.log(`✓ Fixed ${fileName}`);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log(`⚠ ${fileName} not found, skipping`);
    } else {
      console.error(`✗ Error fixing ${fileName}:`, error.message);
      throw error;
    }
  }
}
