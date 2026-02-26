# TestRail Integration

If your team maintains test cases in TestRail, you can generate and execute mobile-automator tests directly from TestRail, keeping both systems in sync.

## Setup

Set environment variables for your mobile project:

```bash
# In your mobile project root, create or update .env
TESTRAIL_API_KEY=your_api_key_here
TESTRAIL_DOMAIN=your-company.testrail.io
```

## Writing Tests in TestRail

Write test cases using **natural language steps**:

| Step Description | Expected Result |
|---|---|
| Launch the app | App opens and shows login screen |
| Enter username testuser@example.com | Username field is populated |
| Tap Login button | Loading spinner appears |
| Wait for home screen | Welcome message displays |

Mobile-automator will fetch these steps, parse them, execute on your device, and generate a scenario JSON file.

## Generating from TestRail

When you run `/mobile-automator:generate`, you can provide a TestRail case URL:

```
> /mobile-automator:generate
? Provide TestRail URL or manual steps:
> https://your-company.testrail.io/index.php?/cases/view/C12345
✓ Fetched test case from TestRail
✓ Converted 4 steps to scenario
✓ Scenario saved to: mobile-automator/scenarios/C12345_2026-02-26.json
```

## Syncing Results

When you execute a scenario from TestRail, results automatically sync back:

```
> /mobile-automator:execute C12345_2026-02-26
Running test...
✓ All assertions passed (5243ms)
✓ Synced to TestRail: Case C12345 → Run TR98765
```

Results in TestRail now include:
- ✅ Pass/fail status
- ⏱️ Execution duration
- 📸 Screenshots (if captured)
- 📊 Observations (flakiness, regressions, state context)
- 🖥️ Device info (OS, model, app version)

## Without TestRail

If you don't use TestRail, mobile-automator works exactly as before:
- Write test steps naturally
- Generate and execute locally
- No TestRail setup needed
