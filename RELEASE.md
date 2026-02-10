# Release Checklist

This checklist guides you through releasing the Mobile QA Skills extension to GitHub for distribution.

## Pre-Release Checklist

- [x] All required files present
  - [x] `gemini-extension.json` with metadata
  - [x] `GEMINI.md` for AI context
  - [x] `package.json` with repository field
  - [x] `README.md` with installation instructions
  - [x] `LICENSE` (Apache 2.0)
  - [x] `CHANGELOG.md` with version history
  - [x] `.gitignore` configured

- [x] Code quality
  - [x] Smoke test passes
  - [x] All skills registered correctly
  - [x] Dependencies bundled

## Release Steps

### 1. Create GitHub Repository

```bash
# Initialize git if not already done
git init

# Create a new public repository on GitHub
# Name: mobile-automator
# Description: Mobile QA automation extension for Gemini CLI
# Visibility: Public
```

### 2. Update Repository URLs

Update the following files with your actual GitHub repository URL:

- [ ] `gemini-extension.json` - Update `repository` field
- [ ] `package.json` - Already updated ✅
- [ ] `README.md` - Replace `your-org` with your GitHub username/org

**Find and replace**:
- `https://github.com/your-org/mobile-automator` → `https://github.com/<YOUR_ORG>/mobile-automator`

### 3. Initial Commit and Push

```bash
# Add all files
git add .

# Create initial commit
git commit -m "Initial release: v1.0.0"

# Add remote (replace YOUR_ORG with your GitHub username/org)
git remote add origin https://github.com/YOUR_ORG/mobile-automator.git

# Push to main branch
git branch -M main
git push -u origin main
```

### 4. Test Installation

```bash
# Test installing from your repository
gemini extensions install https://github.com/YOUR_ORG/mobile-automator
```

### 5. Verify Skills Work

```bash
# Launch Gemini CLI
gemini

# Test each skill
> /setup-qa-skills
> /generate-test-scenarios "test feature"
> /run-test-scenarios <path-to-json>
```

## Post-Release

### Share Installation Command

Users can now install your extension with:

```bash
gemini extensions install https://github.com/YOUR_ORG/mobile-automator
```

### Future Releases

For version updates:

1. Update `version` in `gemini-extension.json` and `package.json`
2. Update `CHANGELOG.md` with changes
3. Commit and push changes
4. Users will be prompted to update automatically

### Optional: Create Release Branches

For managing multiple release channels:

```bash
# Create development branch
git checkout -b dev

# Create preview branch
git checkout -b preview

# Users can install from specific branches:
# gemini extensions install <repo> --ref=dev
# gemini extensions install <repo> --ref=preview
```

## Troubleshooting

**Skills not loading**: Ensure `gemini-extension.json` is at repository root

**mobile-mcp not found**: Run `npm install` in extension directory

**Updates not detected**: Push commits to the branch users are tracking
