# @nmakarov/cli-toolkit

A comprehensive TypeScript toolkit for building CLI applications with advanced argument parsing, configuration loading, environment management, and interactive terminal UI components.

## 🚀 Quick Start

```bash
npm install @nmakarov/cli-toolkit
```

```typescript
// Argument parsing
import { Args } from '@nmakarov/cli-toolkit';

const args = new Args({
  aliases: { 'v': 'verbose', 'd': 'debug' },
  defaults: { timeout: 5000 }
});

console.log(args.get('verbose')); // true if --verbose or -v passed
console.log(args.hasCommand('build')); // true if 'build' command passed

// Interactive terminal UI
import { showListScreen, buildBreadcrumb } from '@nmakarov/cli-toolkit/screen';
import React, { createElement as h, Text, Box } from 'react';

const choice = await showListScreen({
  title: buildBreadcrumb(["Main Menu"]),
  items: [
    { value: "build", title: "Build Project" },
    { value: "test", title: "Run Tests" }
  ],
  onSelect: (item) => item.value,
  footer: "↑↓ to navigate, enter to select, esc to exit"
});
```

## 📋 Precedence Order

**Short Version:** `overrides > CLI args > config files > env vars > defaults`

**Detailed:**
1. **Overrides** (constructor config) - Highest precedence
2. **CLI args** (command line) - `--verbose`, `-v`, `--key=value`
3. **Config files** (loaded from files) - `config.json`, `config.local.json`
4. **Environment variables** - `VERBOSE=true`, `KEY=value`
5. **Defaults** (constructor config) - Lowest precedence

## 🔧 Key Features

### Argument Parsing
- **Case-insensitive** argument parsing
- **Environment-specific** configs and env vars
- **Short flag bundling** (`-vsd` = `-v -s -d`)
- **Negative flags** (`--no-debug`, `--not-verbose`)
- **Config file loading** (JSON/JS with environment support)
- **Dotenv integration** with environment-specific files
- **Singleton pattern** support

### Terminal UI System
- **Interactive lists** with custom rendering, sorting, and scrolling
- **Multi-column layouts** with preview panes
- **Breadcrumb navigation** for clear hierarchy
- **Customizable UI elements** (text blocks, dividers, input fields)
- **Keyboard navigation** with customizable key bindings
- **Responsive design** that adapts to terminal width

### Development
- **TypeScript** with full type safety
- **Clean builds** with no warnings
- **Dual module support** (ESM/CJS)
- **Comprehensive documentation**

## 📖 Documentation

- **[Complete Documentation](./docs/README.md)** - Full API reference and usage guide
- **[API Reference](./docs/API.md)** - Complete API documentation
- **[Screen System Guide](./docs/screen/README.md)** - Terminal UI components and patterns
- **[Quick Reference](./docs/QUICK_REFERENCE.md)** - Cheat sheet for common patterns
- **[Examples](./docs/EXAMPLES.md)** - Real-world usage examples

## 🎯 Examples

### Argument Parsing
```bash
# Basic usage
npx tsx examples/args/show-args.ts --verbose --debug

# Environment-specific
npx tsx examples/args/show-args.ts --env=production

# Config files
npx tsx examples/args/show-args.ts --config=config.json

# Short flags
npx tsx examples/args/show-args.ts -vsd --output=file.txt
```

### Interactive Terminal UI
```bash
# Screen system examples
npx tsx examples/screen/basic.ts

# Interactive argument runner
npx tsx examples/args/show-args-runner.ts
```

## 🛠️ Development

### Prerequisites
- **Node.js**: v20.0.0 or higher (recommended: v24+)
- **npm**: v8.0.0 or higher

### Setup
```bash
git clone https://github.com/nmakarov/cli-toolkit.git
cd cli-toolkit
npm install
```

### Development Workflow

#### Build
```bash
npm run build          # Build for production
npm run dev            # Build in watch mode
```

#### Type Checking
```bash
npm run type-check     # TypeScript type checking
```

#### Linting
```bash
npm run lint           # ESLint checking
```

#### Testing
```bash
npm test               # Run entire vitest suite
npm run test:watch     # Run tests in watch mode
npm run test:ci        # Run *.ci.test.ts across components with coverage
npm run test:args      # Run all Args component tests
npm run test:args:ci   # Run Args CI tests with coverage
npm run test:params    # Run all Params component tests
npm run test:params:ci # Run Params CI tests with coverage
npm run test:screen    # Run all Screen component tests
npm run test:screen:ci # Run Screen CI tests with coverage
```

### Project Structure
```
├── src/                    # Source code
│   ├── args/              # Args module implementation
│   │   ├── index.ts       # Args class and helpers
│   │   └── tests/         # Args component tests
│   ├── args.ts            # Args export surface
│   ├── params/            # Params module implementation
│   │   ├── custom-types.ts# Joi custom types
│   │   ├── index.ts       # Params class and helpers
│   │   └── tests/         # Params component tests
│   ├── params.ts          # Params export surface
│   ├── screen/            # Screen system components
│   │   ├── index.ts       # Screen exports
│   │   ├── components.ts  # Layout components
│   │   ├── ui-elements.ts # UI elements
│   │   ├── list-components.ts # List components
│   │   ├── screens.ts     # Screen functions
│   │   ├── utils.ts       # Utilities
│   │   ├── footer-builder.ts # Footer builder
│   │   └── tests/         # Screen component tests
│   └── index.ts           # Main exports
├── dist/                   # Built files
├── examples/               # Example scripts
│   ├── args/              # Args-specific demos
│   │   ├── functionality-examples.ts
│   │   └── show-args-runner.ts
│   │   └── show-args.ts
│   ├── params/            # Params-specific demos
│   │   └── show-params.ts
│   └── screen/            # Screen system examples
├── examples/example-runner.ts # Main interactive example launcher
├── docs/                   # Documentation
│   └── screen/            # Screen system docs
├── legacy/                 # Legacy reference implementation
└── package.json           # Package configuration
```

### Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Make your changes
4. Run tests: `npm test`
5. Run linting: `npm run lint`
6. Build: `npm run build`
7. Commit your changes: `git commit -m 'Add your feature'`
8. Push to the branch: `git push origin feature/your-feature`
9. Submit a pull request

### Versioning

This project follows [Semantic Versioning](https://semver.org/) (SemVer):

- **MAJOR** (1.0.0): Breaking changes
- **MINOR** (0.1.0): New features (backward compatible)
- **PATCH** (0.0.1): Bug fixes (backward compatible)

#### Version Commands
```bash
# Patch version (0.0.1 → 0.0.2)
npm version patch

# Minor version (0.0.1 → 0.1.0)
npm version minor

# Major version (0.0.1 → 1.0.0)
npm version major

# Pre-release versions
npm version prerelease --preid=alpha    # 0.0.1 → 0.0.2-alpha.0
npm version prerelease --preid=beta     # 0.0.1 → 0.0.2-beta.0
npm version prerelease --preid=rc       # 0.0.1 → 0.0.2-rc.0
```

### Publishing

#### Prerequisites
```bash
# Login to npm (if not already logged in)
npm login

# Verify you're logged in
npm whoami
```

#### Publishing Process

1. **Update version:**
   ```bash
   npm version patch    # or minor/major
   ```

2. **Build the project:**
   ```bash
   npm run build
   ```

3. **Run tests (when available):**
   ```bash
   npm test
   ```

4. **Publish to npm:**
   ```bash
   npm publish
   ```

5. **Push changes to git:**
   ```bash
   git push origin main --tags
   ```

#### Pre-release Publishing

For testing or beta releases:

```bash
# Create pre-release version
npm version prerelease --preid=beta

# Publish pre-release
npm publish --tag beta

# Install pre-release
npm install @nmakarov/cli-toolkit@beta
```

#### Updating Published Package

```bash
# Update patch version
npm version patch && npm publish

# Update minor version  
npm version minor && npm publish

# Update major version
npm version major && npm publish
```

#### Package Verification

```bash
# Check what will be published
npm pack --dry-run

# Verify package contents
npm pack
tar -tzf nmakarov-cli-toolkit-*.tgz

# Test installation
npm install ./nmakarov-cli-toolkit-*.tgz
```

### Release Process

1. **Update version in `package.json`:**
   ```bash
   npm version patch    # or minor/major
   ```

2. **Update `CHANGELOG.md`** with new features/fixes

3. **Build and test:**
   ```bash
   npm run build
   npm run test        # when tests are available
   npm run lint
   ```

4. **Publish:**
   ```bash
   npm publish
   ```

5. **Create GitHub release:**
   ```bash
   git push origin main --tags
   # Then create release on GitHub with changelog
   ```

### Package Configuration

The package is configured for dual module support (ESM/CJS):

```json
{
  "type": "module",
  "main": "./dist/index.js",
  "module": "./dist/index.js", 
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "require": "./dist/index.cjs",
      "types": "./dist/index.d.ts"
    }
  }
}
```

### Troubleshooting

#### Common Issues

**"Package already exists":**
```bash
# Check current version
npm view @nmakarov/cli-toolkit version

# Update version if needed
npm version patch
```

**"Not authorized":**
```bash
# Re-login to npm
npm logout
npm login
```

**"Invalid package name":**
- Ensure package name matches `@nmakarov/cli-toolkit`
- Check `package.json` name field

**"Missing files":**
```bash
# Check files field in package.json
npm pack --dry-run
```

## 🔧 Maintenance

### Security Audits

Regular security audits help keep the project secure:

```bash
# Check for security vulnerabilities
npm audit

# Fix vulnerabilities automatically (if possible)
npm audit fix

# Force fix with potential breaking changes
npm audit fix --force
```

### Dependency Updates

Keep dependencies up to date:

```bash
# Check for outdated packages
npm outdated

# Update specific packages
npm install package-name@latest

# Update all packages (use with caution)
npm update
```

### Security Update Strategy

When `npm audit` shows vulnerabilities:

1. **Check current status:**
   ```bash
   npm audit
   npm outdated
   ```

2. **Update packages individually (recommended):**
   ```bash
   # Update TypeScript first (usually safe)
   npm install typescript@latest
   
   # Update build tools
   npm install tsup@latest
   npm install vitest@latest
   
   # Update other dev dependencies
   npm install typedoc@latest
   npm install @types/node@latest
   ```

3. **Handle peer dependency conflicts:**
   ```bash
   # If conflicts occur, use legacy peer deps
   npm install package-name@latest --legacy-peer-deps
   ```

4. **Verify everything works:**
   ```bash
   npm run build
   npm run type-check
   npm run lint
   npm audit  # Should show 0 vulnerabilities
   ```

### Common Update Issues

#### Peer Dependency Conflicts
```bash
# Error: ERESOLVE could not resolve
# Solution: Update conflicting packages first
npm install typedoc@latest
npm install tsup@latest
```

#### Breaking Changes
```bash
# If updates break functionality, rollback
git checkout -- package.json package-lock.json
npm install
```

#### Package Resolution Issues
```bash
# Clear npm cache if needed
npm cache clean --force
rm -rf node_modules package-lock.json
npm install
```

### Maintenance Checklist

- [ ] Run `npm audit` monthly
- [ ] Check `npm outdated` quarterly  
- [ ] Update dependencies when security issues found
- [ ] Test build after each update
- [ ] Update documentation if APIs change
- [ ] Create release notes for significant updates

## 📄 License

MIT