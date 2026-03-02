# Migrate Command Guide

The **Migrate Command** converts test scenarios from legacy v1 format to modern v2 format, enabling access to advanced features like variables, retry policies, conditional execution, and improved assertions.

**Key benefit**: Update your existing tests to take advantage of v2's more powerful and maintainable test definitions.

## When to Migrate

### You Should Migrate If:

- You have existing v1 test scenarios (older tests)
- You want to use v2 features:
  - Variables and value capture
  - Retry policies for flaky tests
  - Conditional step execution
  - Enhanced assertion types
  - Better error handling

### You Don't Need to Migrate If:

- All your tests are already v2 (new tests)
- Your v1 tests are working fine and you don't need advanced features
- Migration can wait (v1 is deprecated but still supported for 12 months)

## Deprecation Timeline

v1 scenario support follows this timeline:

| Period | Status | What Happens |
|--------|--------|--------------|
| Months 0-6 | ✅ Warnings | Executor shows deprecation warnings but tests still run |
| Months 7-11 | ⚠️ Reduced Support | Limited optimization, slower execution, warnings |
| Month 12+ | ❌ Hard Fail | Executor refuses to run v1 scenarios |

**Current date: 2026-03-01** — Migrate soon while warnings are just informational.

## Quick Start

```bash
# Migrate a single scenario
gemini /mobile-automator:migrate login_happy_path

# Or interactive selection
gemini /mobile-automator:migrate
# (Choose scenario from list)
```

---

## What Changes in v2

### Schema Version

**v1:**
```json
{
  "schema_version": "1.0"
}
```

**v2:**
```json
{
  "$schema_version": "2.0"
}
```

(Note: Field name changed to `$schema_version` with `$` prefix)

### Step IDs

**v1: Integer-based IDs**
```json
{
  "steps": [
    {
      "id": 1,
      "type": "tap",
      "element": "login_button"
    },
    {
      "id": 2,
      "type": "element_text",
      "element": "message",
      "expected": "Success"
    }
  ]
}
```

**v2: Named string IDs**
```json
{
  "steps": {
    "tap_login": {
      "type": "tap",
      "element": "login_button"
    },
    "verify_success": {
      "type": "element_text",
      "element": "message",
      "expected_exact": "Success"
    }
  }
}
```

**Benefits of named IDs:**
- More readable: `tap_login_button` vs `step_1`
- Self-documenting: Clear what each step does
- Easier to debug: Error messages refer to step names
- Better for assertions: Can reference by name instead of number

### Assertion Structure

**v1: Inline assertions**
```json
{
  "steps": [
    {
      "id": 1,
      "type": "element_text",
      "element": "title",
      "expected": "Welcome"
    }
  ]
}
```

**v2: Separate assertions array**
```json
{
  "steps": {
    "verify_title": {
      "type": "wait_for_element",
      "element": "title"
    }
  },
  "assertions": [
    {
      "id": "title_text",
      "type": "element_text",
      "element": "title",
      "expected_exact": "Welcome",
      "description": "Page shows correct title"
    }
  ]
}
```

**Benefits:**
- Clearer separation of actions and checks
- Multiple assertions can verify same step
- Better result reporting

### New v2 Features

#### Variables & Capture

```json
{
  "variables": {
    "order_id": {
      "type": "string",
      "description": "Generated order ID"
    }
  },
  "steps": {
    "capture_order_id": {
      "type": "capture_value",
      "element": "order_number",
      "capture_to": "order_id"
    },
    "verify_confirmation": {
      "type": "element_text",
      "element": "confirmation_text",
      "expected_contains": "Order {{order_id}} confirmed"
    }
  }
}
```

#### Retry Policies

```json
{
  "type": "wait_for_element",
  "element": "data_list",
  "timeout_seconds": 10,
  "retry_policy": {
    "max_retries": 3,
    "wait_between_retries_ms": 2000
  }
}
```

#### Optional Steps

```json
{
  "type": "element_text",
  "element": "newsletter_signup",
  "optional": true
}
```

#### Conditional Execution

```json
{
  "type": "tap",
  "element": "premium_feature",
  "condition": {
    "type": "element_exists",
    "element": "premium_badge"
  }
}
```

#### Enhanced Assertions

v2 supports 27 assertion types (v1 had 12):

| Category | v1 | v2 Additional |
|----------|----|----|
| Element State | element_visible, element_not_visible | element_exists, element_not_exists, element_state |
| Text & Content | (none, in steps) | element_text, text_contains, text_not_empty, element_hint, pattern_match, text_changed, content_description |
| Count & Collections | (none) | element_count, list_item_count, list_is_empty |
| Visual & Layout | (none) | screenshot_match, visual_state, element_fully_visible, color_style |
| Navigation | (none) | screen_title, alert_present, alert_text, toast_visible, keyboard_visible |
| Accessibility | (none) | has_accessibility_label |
| Data | (none) | value_matches_variable |
| Platform-Specific | (none) | permission_dialog_shown, dark_mode_active |

---

## Migration Process

### Step 1: Pre-Migration Verification

Before migrating, verify your v1 scenario is valid:

```bash
# Check scenario format
cat mobile-automator/scenarios/my_old_test.json | jq '.schema_version'
# Output: "1.0"
```

### Step 2: Run Migration Command

```bash
gemini /mobile-automator:migrate my_old_test
```

The migration tool will:

1. **Read v1 scenario**
   - Validates JSON structure
   - Confirms schema_version is "1.0"

2. **Transform structure**
   - Converts integer step IDs to named strings
   - Moves assertions to separate array
   - Updates field names (e.g., `expected` → `expected_exact`)

3. **Generate v2 scenario**
   - Creates new file: `my_old_test_v2.json`
   - Preserves all data and logic
   - Adds v2-specific fields where needed

4. **Show comparison**
   - Displays side-by-side before/after
   - Highlights changes
   - Asks for confirmation

### Step 3: Review Migration

```
Migration Preview
─────────────────

v1 Scenario: my_old_test.json
v2 Result:   my_old_test_v2.json

Changes:
  • Schema version: 1.0 → 2.0
  • Step structure: Array → Object
  • Assertion structure: Inline → Separate array
  • Step IDs: Integer → Named strings
    step_1 → tap_login_button
    step_2 → enter_email
    step_3 → enter_password
    step_4 → tap_signin
    ...

New v2 Fields:
  • Added "description" fields (auto-generated from step intent)
  • Enhanced assertion types

Review the changes? (y/n): y

Detailed Diff:
──────────────
[Side-by-side comparison of JSON structures]

Proceed with migration? (y/n): y
```

### Step 4: Migration Complete

```
✓ Migration successful!

Results:
  • Original: my_old_test.json (untouched)
  • Migrated: my_old_test_v2.json
  • Schema: v1.0 → v2.0

Next steps:
  1. Review: cat mobile-automator/scenarios/my_old_test_v2.json
  2. Test: gemini /mobile-automator:execute
  3. Delete: rm mobile-automator/scenarios/my_old_test.json (when confident)
```

---

## Example Migration

### v1 Scenario (Before)

```json
{
  "schema_version": "1.0",
  "id": "login",
  "description": "User login flow",
  "steps": [
    {
      "id": 1,
      "type": "launch_app",
      "package": "com.example.myapp"
    },
    {
      "id": 2,
      "type": "tap",
      "element": "login_button"
    },
    {
      "id": 3,
      "type": "type",
      "element": "email_field",
      "text": "user@example.com"
    },
    {
      "id": 4,
      "type": "type",
      "element": "password_field",
      "text": "password123"
    },
    {
      "id": 5,
      "type": "tap",
      "element": "signin_button"
    },
    {
      "id": 6,
      "type": "wait_for_element",
      "element": "home_title",
      "timeout_seconds": 10
    },
    {
      "id": 7,
      "type": "element_visible",
      "element": "home_title"
    },
    {
      "id": 8,
      "type": "element_text",
      "element": "welcome_message",
      "expected": "Welcome back"
    }
  ]
}
```

### v2 Scenario (After)

```json
{
  "$schema_version": "2.0",
  "scenario_id": "login",
  "name": "User Login",
  "description": "User login flow",
  "platform": "android",
  "app_package": "com.example.myapp",
  "metadata": {
    "app_version": "1.0.0",
    "environment": "staging"
  },
  "steps": {
    "launch_app": {
      "type": "launch_app",
      "app_package": "com.example.myapp"
    },
    "tap_login_button": {
      "type": "tap",
      "element": "login_button"
    },
    "enter_email": {
      "type": "type",
      "element": "email_field",
      "text": "user@example.com"
    },
    "enter_password": {
      "type": "type",
      "element": "password_field",
      "text": "password123"
    },
    "tap_signin": {
      "type": "tap",
      "element": "signin_button"
    },
    "wait_home_title": {
      "type": "wait_for_element",
      "element": "home_title",
      "timeout_seconds": 10
    }
  },
  "assertions": [
    {
      "id": "home_title_visible",
      "description": "Home title is visible",
      "type": "element_visible",
      "element": "home_title"
    },
    {
      "id": "welcome_message_text",
      "description": "Welcome message shows correct text",
      "type": "element_text",
      "element": "welcome_message",
      "expected_exact": "Welcome back"
    }
  ]
}
```

**Key differences:**
- Schema version field name changed
- Steps are now an object (not array)
- Step IDs are descriptive names (not integers)
- Assertions moved to separate array
- Added required fields: `scenario_id`, `name`, `platform`, `metadata`
- Step references now use descriptive IDs

---

## Post-Migration

### After Migration Completes

1. **Review the migrated scenario**
   ```bash
   cat mobile-automator/scenarios/my_test_v2.json | jq .
   ```

2. **Test it immediately**
   ```bash
   gemini /mobile-automator:execute
   # Select the migrated scenario
   ```

3. **Verify all assertions pass**
   - If tests pass, migration was successful
   - If tests fail, investigate assertions
   - Compare with v1 execution results

4. **Optional: Delete v1 when confident**
   ```bash
   # Keep v1 as backup while testing
   # rm mobile-automator/scenarios/my_old_test.json
   ```

### Updating Scenarios to Use v2 Features

After migration, consider adding v2-specific improvements:

#### Example 1: Add Retry Policy for Flaky Step

```json
{
  "type": "wait_for_element",
  "element": "product_list",
  "timeout_seconds": 10,
  "retry_policy": {
    "max_retries": 3,
    "wait_between_retries_ms": 2000
  }
}
```

#### Example 2: Use Variables for Dynamic Values

```json
{
  "variables": {
    "user_id": {
      "type": "string",
      "description": "Captured user ID"
    }
  },
  "steps": {
    "capture_id": {
      "type": "capture_value",
      "element": "user_id_field",
      "capture_to": "user_id"
    },
    "verify_id": {
      "type": "value_matches_variable",
      "element": "profile_id",
      "variable": "user_id"
    }
  }
}
```

#### Example 3: Add Optional Steps

```json
{
  "type": "element_text",
  "element": "newsletter_prompt",
  "optional": true,
  "description": "Newsletter signup may or may not appear"
}
```

---

## Troubleshooting Migration

### "Migration Failed: Invalid v1 Schema"

**Problem:** v1 scenario doesn't have required fields.

**Solution:**
1. Check schema_version: `"schema_version": "1.0"` (must be exactly this)
2. Check steps array exists and is non-empty
3. Manually fix schema if needed (see v1 examples below)
4. Retry migration

### "Migrated Scenario Doesn't Execute"

**Problem:** v2 scenario migrated but tests fail during execution.

**Causes:**
- Element names changed in app
- Assertions became stricter with v2 rules
- Step order assumption differs

**Solutions:**
1. **Compare v1 vs v2 execution:**
   ```bash
   # Run v1 scenario (still supported)
   gemini /mobile-automator:execute
   # Select original v1 scenario, capture result

   # Run v2 scenario
   gemini /mobile-automator:execute
   # Select migrated v2 scenario, compare results
   ```

2. **Update assertions** — v2 assertions are more specific:
   - v1: `element_text` with `expected` (loose match)
   - v2: `element_text` with `expected_exact` (exact match)
   - Use `text_contains` if you need partial matching

3. **Add explicit waits** — v2 may need more explicit timing:
   ```json
   {
     "type": "wait_for_element",
     "element": "target",
     "timeout_seconds": 10
   }
   ```

4. **Review screenshots** — Check what UI actually looks like vs expectations

### "Need to Roll Back"

If migration caused problems:

```bash
# v1 original is still there
rm mobile-automator/scenarios/my_old_test_v2.json

# Use v1 scenario
gemini /mobile-automator:execute
# Select: my_old_test.json (original)
```

---

## Batch Migration

For migrating multiple scenarios:

```bash
# Migrate all v1 scenarios
for scenario in mobile-automator/scenarios/*.json; do
  if grep -q '"schema_version": "1.0"' "$scenario"; then
    scenario_name=$(basename "$scenario" .json)
    gemini /mobile-automator:migrate "$scenario_name" --auto-confirm
  fi
done
```

This automates migration of all v1 scenarios in your project.

---

## Migration Checklist

Before and after migration:

- [ ] Verify v1 scenario is valid JSON
- [ ] Run v1 scenario, capture baseline results
- [ ] Run migrate command
- [ ] Review migration diff
- [ ] Test migrated v2 scenario
- [ ] Compare v1 vs v2 results (should be identical)
- [ ] Review step names for clarity
- [ ] Consider adding v2 features (retry, variables, conditions)
- [ ] Document any manual changes made
- [ ] Delete v1 when confident (or keep as backup)

---

## Best Practices

### ✅ DO: Use Descriptive Step Names

```json
// Good: Clear intent
"steps": {
  "tap_login_button": {...},
  "enter_email_address": {...},
  "wait_for_home_screen": {...}
}

// Avoid: Generic names
"steps": {
  "step_1": {...},
  "step_2": {...},
  "step_3": {...}
}
```

### ✅ DO: Add Enhanced Assertions

```json
// Good: Specific, documented
"assertions": [
  {
    "id": "email_field_visible",
    "description": "Email input field is visible",
    "type": "element_visible",
    "element": "email_field"
  }
]
```

### ✅ DO: Leverage v2 Features

```json
// Good: Uses v2 advantages
{
  "retry_policy": {"max_retries": 3},
  "variables": {"order_id": {...}},
  "capture_to": "order_id"
}
```

### ❌ DON'T: Ignore Migration Warnings

Always review the migration output carefully.

### ❌ DON'T: Skip Testing

Always run v2 scenario and verify results match v1.

---

## Migration Help

For issues with migration:

1. **Check v2 syntax:** Validate against [v2 Schema Reference](../reference/schema-v2.md)
2. **Review example migrations:** See [Examples](../examples/index.md)
3. **Review the migration examples** in this guide
4. **Check troubleshooting section** above for common issues

---

## See Also

- [Schema v2 Reference](../reference/schema-v2.md) — v2 schema details
- [Assertion Types Reference](../reference/assertions.md) — All available assertions
- [Generate Command Guide](generate.md) — Creating new v2 scenarios
- [FAQ: Migration Issues](../faq.md#troubleshooting)
