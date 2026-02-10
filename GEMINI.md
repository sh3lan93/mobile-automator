# Mobile Automator Extension

This extension provides Mobile QA automation capabilities through a context-driven setup process and bundled mobile automation tools.

## Architecture

The extension follows a **Generator Pattern**:
1. It provides a single entry-point command: `/mobile:setup`.
2. This command analyzes the project and generates customized **skills** in the workspace's `.gemini/skills/` directory.
3. The generated skills (`generate-test` and `run-test`) leverage the bundled `mobile-mcp` tools to control devices.

## Commands

### /mobile:setup
Analyzes the mobile project (Android/iOS) and generates customized workspace skills.
**Use case**: Run once per project to initialize the QA environment.

## Bundle Tools (via mobile-mcp)

The extension provides direct access to mobile automation tools:
- `mobile_list_elements_on_screen`: Inspects UI hierarchy.
- `mobile_click_on_screen_at_coordinates`: Performs touch actions.
- `mobile_take_screenshot`: Captures visual state.
- `mobile_type_text`: Simulates keyboard input.
- `mobile_swipe`: Simulates gestures.

## Workflow

1. **Initialize**: Run `/mobile:setup` in the mobile project root.
2. **Generate**: Use the workspace-local `/generate-test` skill to create a test scenario.
3. **Execute**: Use the workspace-local `/run-test` skill to run the test on a connected device.

## Security
- The setup command is read-only for analysis.
- Workspace skills are stored in your repository.
- Mobile automation is scoped to connected devices/emulators.
