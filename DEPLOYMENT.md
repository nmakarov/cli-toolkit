# Deployment Guide

This document outlines the complete workflow for publishing the CLI Toolkit to npm and managing git releases.

## Prerequisites

### One-Time Setup

1. **npm Account**
   ```bash
   # Create account at https://www.npmjs.com/signup
   # Login to npm
   npm login
   
   # Verify login
   npm whoami
   ```

2. **Git Configuration**
   ```bash
   # Configure git (if not already done)
   git config --global user.name "Your Name"
   git config --global user.email "your.email@example.com"
   ```

3. **GitHub Repository**
   ```bash
   # Create repository at https://github.com/new
   # Add remote (if not already done)
   git remote add origin https://github.com/nmakarov/cli-toolkit.git
   
   # Verify remote
   git remote -v
   ```

## Pre-Release Checklist

Before every release, ensure:

- [ ] All changes are committed to git
- [ ] All CI tests pass: `npm run test:ci`
- [ ] Build succeeds: `npm run build`
- [ ] Documentation is up to date (README, CHANGELOG, FEATURES)
- [ ] No untracked files in git: `git status`
- [ ] You're on the correct branch (usually `main` or `master`)

## Release Workflow

### Automated Release (Recommended)

**IMPORTANT**: Commit all changes before releasing!

```bash
# 1. FIRST: Commit all your changes
git add .
git commit -m "feat: description of changes"

# 2. THEN: Run the release script
npm run release:patch    # For bug fixes (0.1.0 → 0.1.1)
npm run release:minor    # For new features (0.1.0 → 0.2.0)
npm run release:major    # For breaking changes (0.1.0 → 1.0.0)
```

Each release command automatically:
1. Runs `test:ci` (via `prepublishOnly`)
2. Builds the distribution files (via `prepublishOnly`)
3. Bumps the version in `package.json` (creates version commit)
4. Publishes to npm with public access
5. Pushes to GitHub with version tags

**Note**: `npm version` requires a clean working directory. If you see `Git working directory not clean`, you forgot to commit your changes first.

### Manual Release (When Needed)

If you need more control over the process:

```bash
# 1. Run tests
npm run test:ci

# 2. Build distribution
npm run build

# 3. Bump version (choose one)
npm version patch   # 0.1.0 → 0.1.1
npm version minor   # 0.1.0 → 0.2.0
npm version major   # 0.1.0 → 1.0.0

# 4. Publish to npm
npm publish --access public

# 5. Push to git with tags
git push --follow-tags
```

## First-Time Publishing

For the initial package publication:

```bash
# 1. Ensure everything is committed
git add .
git commit -m "Initial commit: CLI Toolkit"

# 2. Push to GitHub
git push -u origin main

# 3. Build and verify
npm run build
npm pack --dry-run  # Preview package contents

# 4. Publish to npm (first time requires --access public)
npm publish --access public

# 5. Create initial git tag
git tag v0.1.0
git push --tags
```

## Post-Release Steps

After every successful release:

1. **Verify npm publication**
   ```bash
   npm view @nmakarov/cli-toolkit
   npm view @nmakarov/cli-toolkit versions
   ```

2. **Test installation**
   ```bash
   # In a temporary directory
   cd /tmp
   mkdir test-install && cd test-install
   npm init -y
   npm install @nmakarov/cli-toolkit
   ```

3. **Update CHANGELOG.md**
   - Move `[Unreleased]` changes to the new version section
   - Add release date
   - Create new `[Unreleased]` section for future work

4. **Announce release** (optional)
   - Update GitHub release notes
   - Post to relevant channels/forums
   - Update project website/documentation

## Hotfix Workflow

For urgent fixes that need immediate release:

```bash
# 1. Create hotfix branch
git checkout -b hotfix/critical-bug

# 2. Make the fix and commit
git add .
git commit -m "Fix: critical bug description"

# 3. Merge to main
git checkout main
git merge hotfix/critical-bug

# 4. Release immediately
npm run release:patch

# 5. Clean up
git branch -d hotfix/critical-bug
```

## Rollback Procedure

If a release has issues:

### Before npm publish
```bash
# Reset version bump
git reset --hard HEAD~1

# Or reset specific file
git checkout HEAD~1 package.json
```

### After npm publish
```bash
# Deprecate the bad version (doesn't unpublish, but warns users)
npm deprecate @nmakarov/cli-toolkit@0.1.x "Critical bug, please upgrade to 0.1.y"

# Publish a fixed version immediately
npm run release:patch
```

**Note**: npm does NOT allow unpublishing versions older than 24 hours. Use deprecation instead.

## Troubleshooting

### Common Issues

**Issue**: `npm ERR! 404 Not Found - GET https://registry.npmjs.org/@nmakarov%2fcli-toolkit`
- **Solution**: Package doesn't exist yet. This is normal for first publish. Use `npm publish --access public`.

**Issue**: `npm ERR! 403 Forbidden - PUT https://registry.npmjs.org/@nmakarov%2fcli-toolkit`
- **Solution**: Not logged in or insufficient permissions. Run `npm login` and try again.

**Issue**: `npm ERR! You do not have permission to publish "@nmakarov/cli-toolkit"`
- **Solution**: Scoped package requires `--access public` flag or npm Teams account.

**Issue**: `Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: Package subpath './module' is not defined`
- **Solution**: Missing export in `package.json`. Add the subpath to `exports` field.

**Issue**: `Cannot find module` in CommonJS projects
- **Solution**: Ensure `tsup.config.ts` includes the module in `entry` and builds both ESM and CJS formats.

**Issue**: Tests fail during `prepublishOnly`
- **Solution**: Fix tests first, or temporarily skip with `npm publish --access public --no-scripts` (not recommended).

### Checking Build Artifacts

```bash
# Verify all exports are built
ls -la dist/

# Expected files for each export:
# - index.js, index.cjs, index.d.ts
# - args.js, args.cjs, args.d.ts
# - params.js, params.cjs, params.d.ts
# - screen.js, screen.cjs, screen.d.ts
# - errors.js, errors.cjs, errors.d.ts
# - logger.js, logger.cjs, logger.d.ts

# Check what will be published
npm pack --dry-run

# Extract and inspect the tarball
npm pack
tar -tzf nmakarov-cli-toolkit-*.tgz
rm *.tgz  # Clean up
```

## Version Naming Strategy

Follow [Semantic Versioning](https://semver.org/):

- **MAJOR** (1.0.0 → 2.0.0): Breaking changes that require user code updates
- **MINOR** (0.1.0 → 0.2.0): New features, backward compatible
- **PATCH** (0.1.0 → 0.1.1): Bug fixes, backward compatible

### Pre-1.0.0 Versions
- `0.x.x` indicates unstable API
- Breaking changes can happen in minor versions
- Once API is stable, release `1.0.0`

## Git Workflow

### Standard Development Cycle

```bash
# 1. Create feature branch
git checkout -b feature/new-feature

# 2. Make changes and commit
git add .
git commit -m "feat: add new feature"

# 3. Merge to main
git checkout main
git merge feature/new-feature

# 4. Release (includes push)
npm run release:patch  # or minor/major

# 5. Clean up
git branch -d feature/new-feature
```

### Commit Message Conventions

Use conventional commits for clarity:

- `feat: description` - New feature (minor version bump)
- `fix: description` - Bug fix (patch version bump)
- `docs: description` - Documentation changes
- `test: description` - Test additions/changes
- `refactor: description` - Code refactoring
- `chore: description` - Maintenance tasks
- `BREAKING CHANGE: description` - Breaking changes (major version bump)

## Release Checklist Template

Copy this for each release:

```markdown
## Release X.Y.Z Checklist

- [ ] All tests passing (`npm run test:ci`)
- [ ] Build succeeds (`npm run build`)
- [ ] CHANGELOG.md updated with changes
- [ ] FEATURES.md updated with status/challenges
- [ ] Version bumped appropriately
- [ ] Git tags pushed
- [ ] npm package published
- [ ] Verified in test project (JS and TS)
- [ ] GitHub release notes created
- [ ] Documentation reflects new version
```

## Continuous Integration (Future)

When setting up CI/CD:

```yaml
# .github/workflows/publish.yml (example)
name: Publish Package

on:
  push:
    tags:
      - 'v*'

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '24'
          registry-url: 'https://registry.npmjs.org'
      - run: npm ci
      - run: npm run test:ci
      - run: npm run build
      - run: npm publish --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

## Support and Maintenance

### Monitoring Published Package

```bash
# Check package info
npm view @nmakarov/cli-toolkit

# Check all versions
npm view @nmakarov/cli-toolkit versions

# Check download stats
npm view @nmakarov/cli-toolkit

# View on npm website
open https://www.npmjs.com/package/@nmakarov/cli-toolkit
```

### Deprecating Versions

```bash
# Deprecate a specific version
npm deprecate @nmakarov/cli-toolkit@0.1.1 "Security vulnerability, upgrade to 0.1.2+"

# Deprecate a range
npm deprecate @nmakarov/cli-toolkit@"<0.1.2" "Outdated, please upgrade"
```

### Updating Dependencies

```bash
# Check for outdated dependencies
npm outdated

# Update dependencies (careful with major versions)
npm update

# Update and test
npm update && npm run test:ci && npm run build
```

## Quick Reference

| Task | Command |
|------|---------|
| Patch release | `npm run release:patch` |
| Minor release | `npm run release:minor` |
| Major release | `npm run release:major` |
| Test before release | `npm run test:ci` |
| Build before release | `npm run build` |
| Verify package | `npm pack --dry-run` |
| Check npm status | `npm view @nmakarov/cli-toolkit` |
| Test install | Create temp dir, `npm install @nmakarov/cli-toolkit` |

## Emergency Contacts

- npm support: https://www.npmjs.com/support
- GitHub support: https://support.github.com
- Package issues: https://github.com/nmakarov/cli-toolkit/issues

