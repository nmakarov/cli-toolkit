# CLI Utilities Development Handoff Prompt

## 🚀 Quick Reference
- **Indent**: 4 spaces, double quotes, semicolons
- **Node**: 24+, ESM+CJS, TypeScript strict
- **Colors**: Never hardcode, always parameterize
- **Args**: `=` separator, case-insensitive, precedence: overrides > CLI > config > env > defaults
- **Screen**: React.createElement, breadcrumbs, customizable everything
- **Build**: tsup, ESLint flat config, Prettier
- **Git**: Conventional commits, SemVer, feature branches

> **📝 Note**: Going forward, if I see considerations worth adding to this PROMPT.md, I'll show you what I'm planning to add right away so we can keep track of those things together.

## Project Context

You are working with a developer who has been building CLI utilities and screen system components. The developer has experience with monorepo structures and has successfully developed a complete CLI screen system framework.

### What's Been Built
- **Screen System Package** (`nm-cli-screen-system`): A complete CLI UI framework ready for npm publishing
- **CLI Development Experience**: Interactive interfaces, audio playback, navigation systems
- **Package Management**: npm publishing, documentation generation, monorepo organization

## Technical Decisions Made

### Package Naming & Publishing
- **Namespace**: `@nmakarov` (personal namespace, totally normal and professional)
- **Screen System**: `nm-cli-screen-system` (ready for npm publishing)
- **CLI Toolkit**: `@nmakarov/cli-toolkit` (grouped by functionality - similar functions in single library, different functionality groups in separate libraries)

### Development Approach
- **Start as separate project** → Develop CLI utilities as standalone modules
- **Publish to npm** → Make them available publicly
- **Create GitHub repo** → Open source the code
- **Later: Monorepo migration** → Move into main project's `packages/` structure
- **Continue development** → Keep developing in context of real application

### Architecture Patterns
- **Functional, composable approach** for building consistent UI screens
- **Action-based architecture** with declarative key bindings and handlers
- **Reusable components** that are self-contained and modular
- **Context API** for components to interact with parent screens
- **Dynamic footers** with auto-grouping and custom content

## Current State

### Ready for Publishing
- **`nm-cli-screen-system`** package is complete and ready for npm publishing
- All documentation generated (README, GUIDE, API, CHEATSHEET, PUBLISHING)
- Package structure, metadata, and licensing in place
- Examples and test data included

### What's Next
- **Refinements**: Continue improving examples, docs, and developer ergonomics
- **Initialization Module**: Setup CLI app structure, config loading (still planned)
- **Decision**: Grouped packages `@nmakarov/cli-toolkit` (similar functions grouped together, different functionality in separate libraries)

## Development Notes

### Key Patterns Established
- **Screen System**: Functional approach with `showScreen`, context API, action-based bindings
- **Component Architecture**: Self-contained components that manage their own state and bindings
- **Navigation**: Position preservation, smart navigation, hierarchical overrides
- **Audio Playback**: Dynamic UI updates, status indicators, proper cleanup

### Important Gotchas
- **Terminal State Management**: UI libraries can leave terminal in bad state - always implement cleanup
- **Audio Playback**: Use proper cleanup handlers, avoid stdin/stdout conflicts
- **Component State**: Use `useRef` and `forceUpdate` for actions to interact with component state
- **Key Bindings**: Implement hierarchical overrides and dynamic enabling/disabling

### Code Organization Principles
- **Single Responsibility**: Each component has one clear purpose
- **Composability**: Components can be combined to build complex screens
- **Reusability**: Extract common patterns into reusable components
- **Minimal Hardcoding**: All UI elements, colors, and styling should be customizable parameters with sensible defaults
- **Documentation**: Comprehensive docs for each package and component

### Minimal Hardcoding Philosophy
- **No hardcoded colors**: All colors (green, white, dim, etc.) should be configurable parameters
- **No hardcoded symbols**: Status symbols (✓, ✗, ↑, ↓) should be customizable
- **No hardcoded spacing**: Padding, margins, and layout should be parameterized
- **No hardcoded text**: Labels, messages, and prompts should be configurable
- **Sensible defaults**: Every customizable parameter must have a reasonable default value
- **Type safety**: All customization options should be properly typed
- **Documentation**: All customization options must be documented with examples

### Current Project State
- **Args module**: ✅ Complete with all legacy features (parsing, config files, env vars, sorting, etc.)
- **Screen module**: ✅ Complete with sorting, scrolling, customization, breadcrumbs
- **Params module**: ✅ Complete with validation, custom types, and singleton helpers
- **Init module**: ⏳ Placeholder (next priority - CLI app structure, config loading)
- **Documentation**: ✅ Updated regularly (README, API, Quick Reference, Examples, changelog)
- **Tests**: ✅ Component-local suites under `src/<component>/tests/` with CI-focused `*.ci.test.ts`
- **Examples**: ✅ Includes functionality samples plus the interactive `examples/example-runner.ts`
- **Logger module**: 🚧 In progress (fallback console logger, full-featured CLI logger with transports, progress throttling, IPC support, CI coverage)
- **Feature tracker**: ✅ Maintain `FEATURES.md` with status updates and challenge notes for each feature

### Common Gotchas & Solutions
- **Stale closures in React**: Use `useRef` for mutable values in actions, recalculate values inside action handlers
- **ESLint quotes rule**: Use `quotes: ['error', 'double']` not `@typescript-eslint/quotes` for TS files
- **tsup JSX in .ts files**: Set `jsx: "transform"` and `loader: { ".ts": "tsx" }` in tsup.config.ts
- **Sorting with selection**: Store item reference from `displayItems`, find new index in sorted list, update scroll
- **Scroll indicators**: Always reserve space (2 chars), combine with selection marker, show only when needed
- **Dotenv debug messages**: Add `quiet: true` to `dotenv.config()` calls
- **Package.json types condition**: Place "types" before "import"/"require" in exports to avoid warnings
- **React key duplication**: Use unique string prefixes for keys in lists and preview components
- **Interactive Ink demos**: Launch via `stdio: "inherit"` when triggered from other programs to avoid raw-mode errors
- **Logger bootstrap**: Initialize with a console-only fallback before swapping to the fully configured logger once params/config are available
- **Feature tracking**: Update `FEATURES.md` alongside planning/implementation, capturing both status and noted challenges
- **Script run command**: Place the `// Run with: ...` comment immediately after imports and before executable code in every runnable script

### Decision Rationale
- **Why 4 spaces**: User preference, consistent with existing codebase, enforced via Prettier
- **Why React.createElement**: Avoids .tsx files, matches legacy approach, cleaner for examples
- **Why tsup over tsc**: Faster builds, better dual module support, handles JSX in .ts files
- **Why grouped packages**: Similar functions together, different functionality separate (not single combined)
- **Why Node.js 24+**: Latest LTS with modern features, better performance, future-proof
- **Why `=` separator**: Clear distinction between key/value pairs and boolean flags + commands
- **Why case-insensitive**: Better UX, matches legacy behavior, handles typos gracefully
- **Why breadcrumb titles**: Clear navigation context, consistent with screen system patterns

## Project Setup & Development Workflow

### Starting a Brand New Project

#### 1. Create Project Structure
```bash
# Create project folder
mkdir cli-toolkit
cd cli-toolkit

# Initialize git
git init
git remote add origin https://github.com/nmakarov/cli-toolkit.git

# Create basic structure
mkdir -p src examples docs tests
touch src/index.ts src/args.ts src/params.ts src/init.ts
touch package.json README.md .gitignore tsconfig.json tsup.config.ts
```

#### 2. Set Up Package.json (TypeScript + Dual Module Support)
```json
{
  "name": "@nmakarov/cli-toolkit",
  "version": "0.1.0",
  "description": "A comprehensive toolkit for building CLI applications",
  "type": "module",
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "require": "./dist/index.cjs",
      "types": "./dist/index.d.ts"
    },
    "./args": {
      "import": "./dist/args.js",
      "require": "./dist/args.cjs",
      "types": "./dist/args.d.ts"
    },
    "./params": {
      "import": "./dist/params.js",
      "require": "./dist/params.cjs",
      "types": "./dist/params.d.ts"
    },
    "./init": {
      "import": "./dist/init.js",
      "require": "./dist/init.cjs",
      "types": "./dist/init.d.ts"
    }
  },
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "test": "vitest",
    "test:watch": "vitest --watch",
    "lint": "eslint src/",
    "type-check": "tsc --noEmit",
    "docs": "typedoc src/index.ts"
  },
  "keywords": ["cli", "args", "params", "bootstrap", "toolkit", "typescript"],
  "author": "nmakarov",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/nmakarov/cli-toolkit.git"
  },
  "files": ["dist/", "README.md", "LICENSE"],
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@typescript-eslint/eslint-plugin": "^6.0.0",
    "@typescript-eslint/parser": "^6.0.0",
    "eslint": "^8.0.0",
    "tsup": "^7.0.0",
    "typescript": "^5.0.0",
    "typedoc": "^0.25.0",
    "vitest": "^1.0.0"
  }
}
```

#### 3. Development Workflow
```bash
# Daily development cycle
git checkout -b feature/args-discovery
# ... develop ...
git add .
git commit -m "feat: add args discovery module"
git push origin feature/args-discovery
# Create PR on GitHub
# After review: merge to main
git checkout main
git pull origin main
npm version patch  # or minor/major
npm publish
```

### Git Workflow Strategy

#### Branch Strategy
- **main**: Production-ready code, always deployable
- **develop**: Integration branch for features
- **feature/***: Individual feature development
- **hotfix/***: Critical fixes for main

#### Commit Convention
```
feat: add new feature
fix: bug fix
docs: documentation changes
style: formatting changes
refactor: code refactoring
test: add tests
chore: maintenance tasks
```

#### Release Process
1. **Feature complete** → Merge to develop
2. **Testing complete** → Merge develop to main
3. **Version bump** → `npm version patch/minor/major`
4. **Publish** → `npm publish`
5. **Tag release** → `git tag v1.0.0 && git push --tags`

### Legacy Project Integration

#### Phase 1: Development (Separate Project)
- Develop `@nmakarov/cli-toolkit` as standalone project
- Publish to npm for testing
- Use in other projects to validate API

#### Phase 2: Migration to Monorepo
```bash
# In your main project
mkdir -p packages/cli-toolkit
cd packages/cli-toolkit

# Copy from standalone project
cp -r /path/to/cli-toolkit/* .
# Update package.json paths
# Update imports in main project
```

#### Phase 3: Integration
```bash
# Update main project's package.json
{
  "dependencies": {
    "@nmakarov/cli-toolkit": "workspace:*"
  }
}

# Update imports
// Before
import { parseArgs } from 'some-other-lib';

// After  
import { parseArgs } from '@nmakarov/cli-toolkit';
```

### Development Environment Setup

#### Required Tools
```bash
# Node.js (latest LTS)
node --version

# npm (comes with Node)
npm --version

# Git
git --version

# Optional: ESLint for code quality
npm install -g eslint
```

#### Project Dependencies
```bash
# Development dependencies
npm install --save-dev @types/node @typescript-eslint/eslint-plugin @typescript-eslint/parser eslint tsup typescript typedoc vitest

# Runtime dependencies (if needed)
npm install --save chalk commander
```

#### TypeScript Configuration
```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true,
    "allowJs": true,
    "strict": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

#### Build Configuration (tsup)
```javascript
// tsup.config.ts
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/args.ts', 'src/params.ts', 'src/init.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
  minify: false,
  target: 'node21'
})
```

#### Testing Strategy
```bash
# Unit tests (TypeScript + Vitest)
npm test

# Watch mode for development
npm run test:watch

# Type checking
npm run type-check

# Build and test
npm run build
npm run dev
```

#### Usage Examples (Dual Module Support)
```typescript
// ESM usage
import { parseArgs } from '@nmakarov/cli-toolkit';
import { parseArgs } from '@nmakarov/cli-toolkit/args';

// CommonJS usage
const { parseArgs } = require('@nmakarov/cli-toolkit');
const { parseArgs } = require('@nmakarov/cli-toolkit/args');
```

## Next Steps

### Immediate Tasks
1. **Start new project folder** `cli-toolkit` for CLI utilities development
2. **Create GitHub repo** `@nmakarov/cli-toolkit`
3. **Set up development environment** with proper tooling
4. **Begin with arguments discovery** - parse CLI args, detect flags, etc.
5. **Build integrated toolkit** with args, params, and init modules

### Development Priorities
1. **Arguments Discovery** - Core functionality for parsing CLI input
2. **Params Management** - Built on top of arguments, with validation and defaults
3. **Initialization/Bootstrap** - Setup CLI app structure, config loading
4. **Documentation** - Each package needs comprehensive docs
5. **Testing** - Unit tests for each utility function

### Migration Checklist (Future)
- [ ] Create GitHub repo for CLI utilities
- [ ] Publish packages to npm
- [ ] Move packages to main project's `packages/` structure
- [ ] Update imports and dependencies
- [ ] Continue development in monorepo context

## Package Structure (Planned)

```
cli-toolkit/
├── src/
│   ├── args.ts           # Arguments discovery and parsing
│   ├── params.ts         # Parameter management and validation
│   ├── init.ts           # CLI app initialization
│   └── index.ts          # Main exports
├── dist/                 # Built JavaScript (ESM + CJS)
│   ├── index.js          # ESM build
│   ├── index.cjs         # CommonJS build
│   ├── index.d.ts        # TypeScript declarations
│   └── ...               # Other modules
├── examples/             # Usage examples
├── docs/                 # Documentation
├── tests/                # Test suites
├── package.json          # @nmakarov/cli-toolkit
├── tsconfig.json         # TypeScript configuration
├── tsup.config.ts       # Build configuration
└── README.md             # Package documentation
```

## Key Considerations

### Scope
- **General-purpose utilities** that can be used in any CLI project
- **Focused on developer experience** - easy to use, well-documented
- **Modular design** - each utility can be used independently
- **TypeScript support** - consider adding TypeScript definitions

### Quality Standards
- **Comprehensive testing** - unit tests for all functions
- **Documentation** - clear examples and API reference
- **Error handling** - robust error messages and recovery
- **Performance** - efficient parsing and validation

### Publishing Strategy
- **Independent versioning** - each package has its own release cycle
- **Semantic versioning** - follow semver for breaking changes
- **Changelog** - document all changes and migrations
- **Migration guides** - help users upgrade between versions

## Contact & Context

This handoff prompt was generated after extensive development of a CLI screen system and various CLI utilities. The developer has experience with:

- **Monorepo management** and package organization
- **CLI development** with interactive interfaces
- **npm publishing** and package management
- **Documentation generation** and developer experience
- **Audio processing** and terminal UI libraries

The next phase focuses on building reusable CLI utilities that can be used across multiple projects, with eventual integration into the main monorepo structure.

## 📋 Complete Development Considerations & Preferences

### 🎨 Coding Style & Formatting
- **4-space indentation** (not tabs, not 2 spaces)
- **Double quotes** for all strings (enforced via ESLint)
- **Semicolons** required (enforced via Prettier)
- **No trailing commas** in objects/arrays (unless multi-line)
- **Consistent spacing** around operators and after commas
- **CamelCase** for variables and functions
- **PascalCase** for classes and interfaces
- **UPPER_CASE** for constants

### 🏗️ Architecture & Design Patterns
- **Direct class instantiation** over factory functions (for flexibility and testing)
- **Functional approach** with composable components
- **Action-based architecture** with declarative key bindings
- **Context API** for component-to-parent communication
- **Self-contained components** that manage their own state
- **Modular design** - each utility can be used independently
- **Single Responsibility Principle** - each component has one clear purpose

### 📦 Package & Module Structure
- **Dual module support** (ESM + CJS) for maximum compatibility
- **Namespace**: `@nmakarov` (personal namespace, professional)
- **Grouped packages** `@nmakarov/cli-toolkit` (similar functions grouped together, different functionality in separate libraries)
- **Explicit entry points** in package.json exports
- **TypeScript-first** with `.d.ts` generation
- **Source maps** enabled for debugging

### 🔧 Build & Development Tools
- **tsup** for building (faster than tsc, handles dual modules)
- **ESLint** with flat config format (modern approach)
- **Prettier** for consistent formatting
- **TypeScript** with strict mode enabled
- **Vitest** for testing (when tests are added)
- **Typedoc** for documentation generation

### 📝 Documentation Standards
- **Comprehensive README** with development workflow
- **API documentation** with examples
- **Quick reference** cheat sheets
- **Real-world usage examples**
- **Maintenance section** for dependency management
- **Command-line examples** in every example file

### 🧪 Testing & Quality
- **Unit tests** for all utility functions (when implemented)
- **Example-driven development** with working examples
- **Error handling** with robust error messages
- **Performance considerations** for CLI tools
- **npm audit** compliance (0 vulnerabilities target)

### 🔄 Git & Versioning
- **Semantic Versioning** (SemVer) for all releases
- **Conventional commits** (feat:, fix:, docs:, etc.)
- **Feature branches** for development
- **Main branch** always deployable
- **Automated versioning** with `npm version`

### ⚙️ CLI Argument Parsing Preferences
- **`=` as separator** for key/value pairs (`--key=value`)
- **`--key value`** treated as boolean `true` + command
- **Short flag support** with aliases (`--silent` and `-s`)
- **Short flag bundling** (`-vsd` = verbose + silent + debug)
- **Negative flags** (`--no-debug`, `--not-verbose`)
- **Quoted values** support (`--key="value with spaces"`)
- **Case-insensitive** key lookup
- **Environment variable** integration (camelCase → CAMEL_CASE)

### 📊 Argument Precedence Order
1. **overrides** (highest priority)
2. **CLI arguments**
3. **config files** (environment-specific)
4. **environment variables** (including env-specific)
5. **defaults** (lowest priority)

### 🗂️ Configuration File Handling
- **Environment-specific** configs (`config.local.json`, `config.production.json`)
- **JSON and JS** file support
- **Automatic discovery** in examples folder
- **Error handling** for missing/unreadable files
- **Dotenv integration** with environment-specific `.env` files

### 🎯 Screen System Preferences
- **React.createElement** over JSX syntax (for `.ts` files)
- **No `.tsx` files** for examples (use `.ts` with `React.createElement`)
- **Breadcrumb navigation** in titles
- **Consistent spacing** for UI elements
- **Scroll indicators** (↑, ↓) when needed
- **Customizable selection markers** (default: space)
- **Smart scrolling** to keep selected items visible
- **Sorting with item preservation** (selected item stays selected)

### 🎨 UI/UX Preferences
- **Chalk** for terminal coloring
- **Dim text** for secondary information
- **Bright white** for important elements
- **Green** for success/positive states
- **Consistent spacing** and alignment
- **Clean, uncluttered** output
- **Status symbols** (✓, ✗, ↑, ↓) for visual feedback

### 🔍 Error Handling & Debugging
- **Quiet mode** for dotenv (suppress debug messages)
- **No console.log** in production code
- **Graceful fallbacks** for missing configurations
- **Clear error messages** with context
- **Debug logging** only when explicitly enabled

### 📁 File Organization
- **`src/`** for source code
- **`examples/`** for usage examples
- **`docs/`** for documentation
- **`dist/`** for built files
- **`legacy/`** for reference (never modify)
- **Clear separation** between modules

### 🚀 Performance & Optimization
- **Efficient parsing** algorithms
- **Minimal dependencies** (only what's needed)
- **Fast build times** with tsup
- **Lazy loading** where appropriate
- **Memory efficient** for CLI tools

### 🔒 Security & Best Practices
- **No hardcoded secrets** or API keys
- **Input validation** for all user inputs
- **Safe file operations** with proper error handling
- **Dependency auditing** (npm audit compliance)
- **Regular updates** for security patches

### 🌐 Compatibility & Standards
- **Node.js 21+** target
- **Cross-platform** compatibility
- **ESM and CJS** support
- **TypeScript** strict mode
- **Modern JavaScript** features (ES2022+)

### 📋 Development Workflow
- **Build before testing** (`npm run build`)
- **Lint before committing** (`npm run lint`)
- **Type checking** (`npm run type-check`)
- **Example-driven** development
- **Iterative refinement** based on user feedback

### 🧪 Testing Philosophy
- **Example-driven development**: Every feature demonstrated with working examples
- **Integration tests**: Test complete workflows, not just unit functions
- **CLI testing**: Use `child_process.spawn` for testing actual CLI behavior
- **Mock external dependencies**: Don't test file system, network calls in unit tests
- **Test data**: Include realistic test datasets (like sample-words.json)

### ⚡ Performance Guidelines
- **Lazy loading**: Load heavy modules only when needed
- **Memory efficiency**: Avoid keeping large datasets in memory
- **Fast startup**: CLI tools should start quickly (< 100ms)
- **Efficient parsing**: Use streaming for large files, avoid loading everything at once
- **Caching**: Cache parsed configs and computed values when appropriate

### 🚨 Error Handling Standards
- **Graceful degradation**: Continue working with partial data when possible
- **Clear error messages**: Include context about what went wrong and how to fix it
- **Error recovery**: Provide fallbacks and retry mechanisms
- **User-friendly errors**: Technical details in debug mode, simple messages for users
- **Exit codes**: Use standard exit codes (0=success, 1=error, 2=usage error)

### 📚 Documentation Lifecycle
- **Living documentation**: Update docs with every code change
- **Version compatibility**: Document breaking changes and migration paths
- **Example validation**: Ensure all examples actually work
- **API consistency**: Keep documentation in sync with actual API
- **Changelog discipline**: Document every change, no matter how small

## 🛠️ Code Templates

### Component with Customization
```typescript
interface ComponentProps {
    color?: string;
    symbol?: string;
    spacing?: number;
    // ... other props
}

const Component = ({ 
    color = "white", 
    symbol = "✓", 
    spacing = 1,
    ...props 
}: ComponentProps) => {
    // implementation with customizable parameters
};
```

### Screen Component with Actions
```typescript
const MyScreen = ({ items, onSelect }: MyScreenProps) => {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const selectedIndexRef = useRef(0);
    const [, forceUpdate] = useState({});

    useEffect(() => {
        const ctx = getScreenContext();
        
        ctx.setAction("moveUp", () => {
            selectedIndexRef.current = Math.max(0, selectedIndexRef.current - 1);
            forceUpdate({});
        });
        
        ctx.setAction("moveDown", () => {
            selectedIndexRef.current = Math.min(items.length - 1, selectedIndexRef.current + 1);
            forceUpdate({});
        });
        
        ctx.setKeyBinding("up", "moveUp", "↑ to move up");
        ctx.setKeyBinding("down", "moveDown", "↓ to move down");
    }, [items.length]);

    return h(ScreenContainer, {}, 
        // screen content
    );
};
```

### Args Class Usage
```typescript
const args = new Args({
    args: process.argv.slice(2),
    aliases: { s: "silent", v: "verbose", d: "debug" },
    overrides: { debug: true },
    defaults: { timeout: 5000 }
});

// Get values with precedence: overrides > CLI > config > env > defaults
const debug = args.get("debug"); // boolean
const output = args.get("output"); // string | undefined
const commands = args.getUsed(); // string[]
const unused = args.getUnused(); // string[]
```

### List Component with Custom Rendering
```typescript
const MyList = ({ items, maxHeight = 10 }: MyListProps) => {
    return h(ListComponent, {
        items,
        maxHeight,
        sortable: true,
        getTitle: (item) => item.title,
        renderItem: (item, isSelected) => {
            return h(Text, {}, 
                h(Text, { color: "white", bold: true }, item.title),
                h(Text, { dimColor: true }, ` - ${item.description}`)
            );
        }
    });
};
```

### Package.json Exports (Dual Module)
```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    },
    "./args": {
      "types": "./dist/args.d.ts", 
      "import": "./dist/args.js",
      "require": "./dist/args.cjs"
    }
  }
}
```

### ESLint Config (Flat)
```javascript
import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

export default [
    js.configs.recommended,
    {
        files: ['**/*.ts', '**/*.tsx'],
        languageOptions: {
            parser: tsparser,
            globals: {
                process: 'readonly',
                console: 'readonly',
                Buffer: 'readonly'
            }
        },
        plugins: { '@typescript-eslint': tseslint },
        rules: {
            'quotes': ['error', 'double'],
            'indent': ['error', 4],
            'no-unused-vars': 'off',
            '@typescript-eslint/no-unused-vars': 'error'
        }
    }
];
```
