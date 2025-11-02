#!/usr/bin/env node

// Functionality examples of the Args class
// 
// Command lines to run this example:
// npx tsx examples/args/functionality-examples.ts
// npx tsx examples/args/functionality-examples.ts --verbose --output=file.txt
// npx tsx examples/args/functionality-examples.ts -v -o=file.txt
// npx tsx examples/args/functionality-examples.ts build --verbose --output="quoted value"
// npx tsx examples/args/functionality-examples.ts --verbose build --output=file.txt

import { Args } from "../../src/args.js";

console.info("=== Args Class Functionality Examples ===\n");

// Example 1: Basic usage with no arguments
console.info("1. Basic usage (no arguments):");
const args1 = new Args();
console.info("Commands:", args1.getCommands());
console.info("Used keys:", args1.getUsed());
console.info("Unused keys:", args1.getUnused());
console.info("");

// Example 2: With aliases and defaults
console.info("2. With aliases and defaults:");
const args2 = new Args({
  args: ["--verbose", "--output=file.txt"],
  aliases: { "v": "verbose", "o": "output" },
  defaults: { "format": "json", "timeout": 5000 }
});

console.info("verbose:", args2.get("verbose"));  // true
console.info("output:", args2.get("output"));    // 'file.txt'
console.info("format:", args2.get("format"));     // 'json' (default)
console.info("timeout:", args2.get("timeout"));   // 5000 (default)
console.info("");

// Example 3: Short form aliases
console.info("3. Short form aliases:");
const args3 = new Args({
  args: ["-v", "-o=file.txt"],
  aliases: { "v": "verbose", "o": "output" }
});

console.info("verbose (from -v):", args3.get("verbose"));  // true
console.info("output (from -o):", args3.get("output"));    // 'file.txt'
console.info("");

// Example 4: Commands and flags
console.info("4. Commands and flags:");
const args4 = new Args({
  args: ["build", "--verbose", "--output=dist/"]
});

console.info("Commands:", args4.getCommands());
console.info("Has command \"build\":", args4.hasCommand("build"));
console.info("verbose:", args4.get("verbose"));
console.info("output:", args4.get("output"));
console.info("");

// Example 5: Quoted values
console.info("5. Quoted values:");
const args5 = new Args({
  args: ["--message=\"Hello World\"", "--path='\/home\/user'", "--key=\"5=five\""]
});

console.info("message:", args5.get("message"));  // 'Hello World'
console.info("path:", args5.get("path"));       // '/home/user'
console.info("key:", args5.get("key"));          // '5=five'
console.info("");

// Example 6: Overrides (highest precedence)
console.info("6. Overrides (highest precedence):");
const args6 = new Args({
  args: ["--verbose", "--output=file.txt"],
  aliases: { "v": "verbose", "o": "output" },
  overrides: { "verbose": false, "format": "xml" },
  defaults: { "timeout": 5000 }
});

console.info("verbose (overridden):", args6.get("verbose"));  // false (override wins)
console.info("output (from CLI):", args6.get("output"));     // 'file.txt'
console.info("format (override):", args6.get("format"));    // 'xml' (override wins)
console.info("timeout (default):", args6.get("timeout"));    // 5000 (default)
console.info("");

// Example 7: Conflict detection
console.info("7. Conflict detection:");
try {
  const args7 = new Args({
    args: ["-v", "--verbose"],
    aliases: { "v": "verbose" }
  });
  console.info("This should not print");
} catch (error: any) {
  console.info("Error caught:", error.message);
}
console.info("");

// Example 8: Usage tracking
console.info("8. Usage tracking:");
const args8 = new Args({
  args: ["--verbose", "--output=file.txt", "--unused-flag"],
  aliases: { "v": "verbose", "o": "output" }
});

// Access some values
args8.get("verbose");
args8.get("output");

console.info("Used keys:", args8.getUsed());
console.info("Unused keys:", args8.getUnused());
console.info("");

// Example 9: Get all parsed data
console.info("9. Get all parsed data:");
const args9 = new Args({
  args: ["build", "--verbose", "--output=dist/", "--format=json"],
  aliases: { "v": "verbose", "o": "output", "f": "format" }
});

const parsed = args9.getParsed();
console.info("Parsed data:", JSON.stringify(parsed, null, 2));
console.info("");

console.info("=== Example completed ===");


