#!/usr/bin/env node
/**
 * Post-build script to fix ESM-only dependencies in CJS builds
 * Converts require() calls for ink and react to use dynamic imports
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const distDir = join(process.cwd(), 'dist');
const screenCjsPath = join(distDir, 'screen.cjs');

console.log('Fixing ESM dependencies in screen.cjs...');

let code = readFileSync(screenCjsPath, 'utf-8');

// Check if already transformed
if (code.includes('__esmCache')) {
  console.log('screen.cjs already transformed, skipping');
  process.exit(0);
}

// Create the ESM loader code
const loaderCode = `
var __esmCache = {};
var __loadESMSync = function(moduleName) {
  if (!__esmCache[moduleName]) {
    throw new Error(\`ESM module "\${moduleName}" not loaded. Please call the load() function first: const screen = require("@nmakarov/cli-toolkit/screen"); await screen.load();\`);
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
  code = code.replace(/(module\.exports = __toCommonJS\(screen_exports\);)/, `${loadFunction}\n$1`);
}

// Find and fix top-level assignments that use import variables
// Pattern: var h2 = import_react2.createElement;
// These need to be lazy too
const topLevelAssignments = code.match(/var\s+\w+\s*=\s*import_\w+\.\w+;/g);
if (topLevelAssignments) {
  topLevelAssignments.forEach(assignment => {
    // Extract variable name and the import variable
    const match = assignment.match(/var\s+(\w+)\s*=\s*(import_\w+)\.(\w+);/);
    if (match) {
      const [, varName, importVar, prop] = match;
      // Replace with a getter that will work after load()
      // We'll use Object.defineProperty to make it lazy
      const getterCode = `var ${varName}; Object.defineProperty(global, '${varName}', { get: function() { if (!${importVar}) throw new Error('ESM modules not loaded. Call load() first.'); return ${importVar}.${prop}; }, configurable: true }); ${varName} = (function() { if (!${importVar}) throw new Error('ESM modules not loaded. Call load() first.'); return ${importVar}.${prop}; })();`;
      code = code.replace(assignment, getterCode);
    }
  });
}

// Actually, simpler: just make these assignments happen inside functions that check if loaded
// Replace: var h2 = import_react2.createElement;
// With: var h2 = function() { if (!import_react2) throw new Error('...'); return import_react2.createElement; }();
// But that still executes immediately. Let me use a different approach:

// Remove intermediate variable assignments that use import variables
// These execute immediately and cause errors during module load
// The pattern from previous transformations creates long lines with Object.defineProperty
// Remove lines that contain both "var" and "import_" and "Object.defineProperty" and "createElement"
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

// Update exports to include load function
if (!code.includes('load: () => load')) {
  code = code.replace(
    /(__export\(screen_exports, \{)/,
    `$1\n  load: () => load,`
  );
}

writeFileSync(screenCjsPath, code, 'utf-8');
console.log('✓ Fixed screen.cjs');
