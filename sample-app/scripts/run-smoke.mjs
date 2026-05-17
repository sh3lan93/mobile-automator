import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const scenarioPath = join(__dirname, '..', 'scenarios', 'smoke_nav.json');
const screenshotDir = join(__dirname, '..', 'screenshots', 'smoke_nav');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(msg) {
  console.log(`[smoke] ${msg}`);
}

/**
 * Parse the result of a tool call.
 *
 * Handles two response shapes from mobile-mcp:
 *   1. Plain JSON  — e.g. '{"devices":[...]}' (mobile_list_available_devices)
 *   2. Prose-prefixed JSON — e.g. 'Found these elements on screen: [{...}]'
 *      (mobile_list_elements_on_screen)
 *
 * Image content items are returned as-is.
 */
function parseToolResult(result) {
  const item = result.content?.[0];
  if (!item) throw new Error('Empty tool result');
  if (item.type === 'image') return item;
  const text = item.text ?? '';
  // Try plain JSON first (handles {"devices":[...]}, etc.)
  try { return JSON.parse(text); } catch {}
  // Extract first JSON array or object from prose-prefixed responses
  const match = text.match(/([\[{][\s\S]*[\]}])\s*$/);
  if (match) return JSON.parse(match[1]);
  throw new Error(`Cannot parse tool result: ${text.slice(0, 120)}`);
}

async function callTool(client, name, args = {}) {
  return client.callTool({ name, arguments: args });
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Step executors
// ---------------------------------------------------------------------------

async function execLaunchApp(client, step, scenario, deviceId) {
  log(`[${step.id}] launch_app → packageName=${scenario.app_package} device=${deviceId}`);
  await callTool(client, 'mobile_launch_app', {
    device: deviceId,
    packageName: scenario.app_package,
  });
}

async function execWaitForElement(client, step, deviceId) {
  const timeoutMs = step.wait_config?.timeout_ms ?? 30000;
  const pollMs = 2000;
  const deadline = Date.now() + timeoutMs;
  log(`[${step.id}] wait_for_element target="${step.target}" timeout=${timeoutMs}ms`);

  while (Date.now() < deadline) {
    const result = await callTool(client, 'mobile_list_elements_on_screen', { device: deviceId });
    // Response is a flat array, NOT { elements: [...] }
    const elements = parseToolResult(result);
    const found = (Array.isArray(elements) ? elements : []).find(
      (el) => el.identifier === step.target,
    );
    if (found) {
      log(`[${step.id}] element found`);
      return;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await sleep(Math.min(pollMs, remaining));
  }

  throw new Error(`[${step.id}] Timed out waiting for element "${step.target}" after ${timeoutMs}ms`);
}

async function execTap(client, step, deviceId) {
  log(`[${step.id}] tap target="${step.target}"`);
  const result = await callTool(client, 'mobile_list_elements_on_screen', { device: deviceId });
  // Response is a flat array; coordinates are nested under el.coordinates
  const elements = parseToolResult(result);
  const el = (Array.isArray(elements) ? elements : []).find((e) => e.identifier === step.target);
  if (!el) {
    throw new Error(`[${step.id}] Element "${step.target}" not found on screen`);
  }
  const cx = el.coordinates.x + el.coordinates.width / 2;
  const cy = el.coordinates.y + el.coordinates.height / 2;
  log(`[${step.id}] clicking at (${cx}, ${cy})`);
  await callTool(client, 'mobile_click_on_screen_at_coordinates', { device: deviceId, x: cx, y: cy });
}

// ---------------------------------------------------------------------------
// Checkpoint screenshot
// ---------------------------------------------------------------------------

async function takeCheckpoint(client, step, deviceId) {
  log(`[${step.id}] checkpoint — taking screenshot`);
  const result = await callTool(client, 'mobile_take_screenshot', { device: deviceId });
  const item = result.content[0];
  let base64;
  if (item.type === 'image') {
    base64 = item.data;
  } else {
    const parsed = parseToolResult(result);
    base64 = parsed.screenshot ?? parsed;
  }
  mkdirSync(screenshotDir, { recursive: true });
  const outPath = join(screenshotDir, `step_${step.id}.png`);
  writeFileSync(outPath, Buffer.from(base64, 'base64'));
  log(`[${step.id}] screenshot saved → ${outPath}`);
}

// ---------------------------------------------------------------------------
// Step dispatch with retry
// ---------------------------------------------------------------------------

async function runStep(client, step, scenario, deviceId) {
  const maxAttempts = step.retry_policy?.max_attempts ?? 1;
  const backoffMs = step.retry_policy?.backoff_ms ?? 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (attempt > 1) {
        log(`[${step.id}] retry attempt ${attempt}/${maxAttempts} after ${backoffMs}ms backoff`);
        await sleep(backoffMs);
      }

      switch (step.action) {
        case 'launch_app':
          await execLaunchApp(client, step, scenario, deviceId);
          break;
        case 'wait_for_element':
          await execWaitForElement(client, step, deviceId);
          break;
        case 'tap':
          await execTap(client, step, deviceId);
          break;
        default:
          throw new Error(`Unknown action: ${step.action}`);
      }

      if (step.checkpoint) {
        await takeCheckpoint(client, step, deviceId);
      }

      return; // success
    } catch (err) {
      if (attempt >= maxAttempts) {
        throw err;
      }
      console.error(`[smoke] [${step.id}] attempt ${attempt} failed: ${err.message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const scenario = JSON.parse(readFileSync(scenarioPath, 'utf8'));
  log(`scenario loaded: "${scenario.name}" (${scenario.steps.length} steps)`);

  // Use the pinned local installation of mobile-mcp (bin: mcp-server-mobile → lib/index.js)
  const mcpBin = join(__dirname, 'node_modules', '.bin', 'mcp-server-mobile');
  const transport = new StdioClientTransport({
    command: mcpBin,
    args: [],
  });

  const client = new Client(
    { name: 'smoke-runner', version: '1.0.0' },
    { capabilities: {} },
  );

  await client.connect(transport);
  log('connected to mobile-mcp — waiting 3s for server warm-up');
  await sleep(3000);

  try {
    // Confirm device availability and capture the deviceId for all subsequent calls
    const devResult = await callTool(client, 'mobile_list_available_devices');
    // Response is {devices:[...]} not a flat array
    const parsed = parseToolResult(devResult);
    const devices = Array.isArray(parsed) ? parsed : (parsed.devices ?? []);
    if (!devices || devices.length === 0) {
      throw new Error('No connected devices found');
    }
    const deviceId = devices[0].id ?? devices[0].udid ?? devices[0].deviceId;
    if (!deviceId) {
      throw new Error(`Device found but no id field: ${JSON.stringify(devices[0])}`);
    }
    log(`devices found: ${devices.map((d) => d.name ?? d.id ?? JSON.stringify(d)).join(', ')}`);
    log(`using device: ${deviceId}`);

    // Execute steps
    for (const step of scenario.steps) {
      log(`--- step: ${step.id} (${step.action}) ---`);
      await runStep(client, step, scenario, deviceId);
    }

    log('smoke scenario completed successfully');
  } finally {
    await client.close();
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

(async () => {
  try {
    await main();
    process.exit(0);
  } catch (err) {
    console.error(`[smoke] Fatal error: ${err.message}`);
    process.exit(1);
  }
})();
