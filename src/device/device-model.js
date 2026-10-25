'use strict';

// Agnostic device shape for `mauto devices`. We deliberately surface ONLY the
// four stable keys an agent needs to pick a target — id, name, platform, state
// — and drop every other raw mobile-mcp field (no resource-id, no OS-specific
// internals). `os` is mapped onto `platform` so the output reads the same way
// across the Android/iOS/simulator variants mobile-mcp returns.
//
// deviceRecords is the ONE parser of the raw list. Its records also carry
// `type` (simulator/emulator/real), which DeviceBridge needs internally;
// normalizeDevices is only the public 4-key view of those records.

function nullable(v) {
  return v === undefined || v === null || v === '' ? null : v;
}

function recordOf(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const id = nullable(
    raw.id !== undefined
      ? raw.id
      : raw.udid !== undefined
        ? raw.udid
        : raw.deviceId !== undefined
          ? raw.deviceId
          : raw.serial
  );
  if (id == null) return null; // an unidentifiable device is not selectable

  const name = nullable(
    raw.name !== undefined ? raw.name : raw.deviceName
  );

  // mobile-mcp reports the OS under `os`; expose it agnostically as `platform`.
  const platform = nullable(
    raw.platform !== undefined ? raw.platform : raw.os
  );

  const state = nullable(raw.state !== undefined ? raw.state : raw.status);

  const type = nullable(raw.type);

  return { id: String(id), name, platform, state, type };
}

function deviceRecords(raw) {
  let list;
  if (Array.isArray(raw)) {
    list = raw;
  } else if (raw && Array.isArray(raw.devices)) {
    list = raw.devices;
  } else {
    return [];
  }

  const out = [];
  for (const item of list) {
    const d = recordOf(item);
    if (d) out.push(d);
  }
  return out;
}

function publicView({ id, name, platform, state }) {
  return { id, name, platform, state };
}

function normalizeDevices(raw) {
  return deviceRecords(raw).map(publicView);
}

function isIosSimulator(record) {
  if (!record) return false;
  return (
    String(record.platform || '').toLowerCase() === 'ios' &&
    String(record.type || '').toLowerCase() === 'simulator'
  );
}

module.exports = { deviceRecords, normalizeDevices, isIosSimulator };
