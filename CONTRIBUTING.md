# Contributing to Sharriff

Thank you for your interest in contributing to Sharriff!

## Development Setup

1. **Fork and clone the repository**

```bash
git clone https://github.com/YOUR_USERNAME/sharriff.git
cd sharriff
```

2. **Install dependencies**

```bash
npm install
```

3. **Create a feature branch**

```bash
git checkout -b feat/your-feature-name
```

## Development Workflow

### Running Locally

```bash
# Development mode (with hot reload)
npm run dev

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Check everything before committing
npm run check
```

### Code Quality

All code must pass:

- ✅ TypeScript type checking (`npm run type-check`)
- ✅ ESLint (`npm run lint`)
- ✅ Prettier formatting (`npm run format:check`)
- ✅ All tests (`npm test`)

Run `npm run check` to verify everything at once.

## Pull Request Process

### 1. Conventional Commits

PR titles **must** follow [Conventional Commits](https://www.conventionalcommits.org/) format. This generates categorized release notes automatically.

**Format:** `<type>: <description>`

**Types:**

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `chore`: Maintenance tasks (dependencies, config)
- `refactor`: Code improvements without behavior changes
- `test`: Test additions or improvements
- `perf`: Performance improvements

**Examples:**

```
feat: implement retry_interval_days filtering
fix: handle shutdown during API calls
docs: update Docker deployment guide
chore: update dependencies to latest versions
refactor: simplify config parser logic
test: add coverage for edge cases
perf: optimize batch processing loop
```

### 2. Create Pull Request

1. Push your branch to your fork
2. Open a PR against `main` branch
3. Ensure CI checks pass ✅
   - Tests (all 144+ tests)
   - Type checking
   - Linting
   - Code formatting
   - Coverage report
   - Docker image build
4. Wait for code review

**PR Docker Images:** Each PR automatically builds a Docker image tagged with the PR number (e.g., `ghcr.io/meerumschlungen/sharriff:pr123`). You can use this to test your changes in a containerized environment:

```bash
docker pull ghcr.io/meerumschlungen/sharriff:pr123
docker run -v ./config.yaml:/config/sharriff.yaml:ro ghcr.io/meerumschlungen/sharriff:pr123
```

### 3. Code Review

- PRs require at least one approval
- Address review feedback with additional commits
- Once approved, maintainers will merge

## Release Process

Releases are automated and follow [Semantic Versioning](https://semver.org/):

- **Major** (`1.0.0` → `2.0.0`): Breaking changes
- **Minor** (`1.0.0` → `1.1.0`): New features (backward compatible)
- **Patch** (`1.0.0` → `1.0.1`): Bug fixes

### For Maintainers

Since the `main` branch is protected and requires PRs, releases are created via a version bump PR:

```bash
# 1. Create a release branch
git checkout main
git pull
git checkout -b release/1.1.0

# 2. Bump version in package.json (without creating a git tag)
npm version 1.1.0 --no-git-tag-version

# 3. Commit and push the version bump
git add package.json
git commit -m "chore: bump version to 1.1.0"
git push origin release/1.1.0

# 4. Create PR with title: "chore: bump version to 1.1.0"
#    - Get it reviewed and merged

# 5. After PR is merged, create and push the release tag
git checkout main
git pull
git tag v1.1.0
git push origin v1.1.0
```

This triggers the automated release workflow:

1. Run full test suite
2. Build Docker images (linux/amd64, linux/arm64)
3. Push to GHCR with tags: `1.1.0`, `1.1`, `1`
4. Create GitHub release **draft** with auto-generated release notes
5. **Review and publish the release draft** on GitHub to make it public

**Version Numbering:**

- **Patch** (`1.0.0` → `1.0.1`): Bug fixes only
- **Minor** (`1.0.0` → `1.1.0`): New features (backward compatible)
- **Major** (`1.0.0` → `2.0.0`): Breaking changes

## Testing

### Writing Tests

- Use Vitest for all tests
- Place tests in `tests/` directory
- Name test files: `*.test.ts`
- Aim for high coverage on critical paths

### Running Tests

```bash
# Run all tests once
npm test

# Watch mode (re-runs on file changes)
npm run test:watch

# Coverage report
npm run test:coverage

# Interactive UI
npm run test:ui
```

## Code Style

- Use TypeScript strict mode
- Follow existing patterns in the codebase
- Prefer functional programming over classes
- Keep functions small and focused
- Write descriptive variable names

The project uses:

- **ESLint** for code quality
- **Prettier** for formatting
- **TypeScript** for type safety

Run `npm run lint:fix` and `npm run format` to auto-fix most issues.

## Questions?

Open an issue for:

- Bug reports
- Feature requests
- General questions

Thank you for contributing! 🎉
