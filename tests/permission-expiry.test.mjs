import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { normalizePermissionExpiry } from '../lib/permission-expiry.ts';

const helper = new URL('../lib/permission-expiry.ts', import.meta.url).href;
const inTimezone = (timezone, code) => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `import {defaultPermissionExpiry,formatLocalDateTime,normalizePermissionExpiry} from ${JSON.stringify(helper)};${code}`], { env: { ...process.env, TZ: timezone }, encoding: 'utf8' }));

test('a one-hour grant keeps its precise expiry when entered in the local time zone', () => {
  for (const timezone of ['America/Los_Angeles', 'UTC', 'Asia/Kolkata']) {
    const result = inTimezone(timezone, `const start=Date.parse('2026-10-05T16:22:13Z');const input=formatLocalDateTime(new Date(start+3600000));console.log(JSON.stringify({input,expiry:normalizePermissionExpiry(input,'datetime-local')}));`);
    assert.equal(result.expiry, '2026-10-05T17:22:13.000Z', timezone);
    assert.equal(Date.parse(result.expiry) - Date.parse('2026-10-05T16:22:13Z'), 3600000, timezone);
  }
});

test('the existing 30-day UTC end-of-day default survives local rendering, including a DST change', () => {
  for (const [timezone, expectedInput] of [['America/Los_Angeles', '2026-11-04T15:59:59'], ['UTC', '2026-11-04T23:59:59'], ['Asia/Kolkata', '2026-11-05T05:29:59']]) {
    const result = inTimezone(timezone, `const input=defaultPermissionExpiry(Date.parse('2026-10-05T16:22:13Z'));console.log(JSON.stringify({input,expiry:normalizePermissionExpiry(input,'datetime-local')}));`);
    assert.equal(result.input, expectedInput, timezone);
    assert.equal(result.expiry, '2026-11-04T23:59:59.000Z', timezone);
  }
});

test('local minute-only input converts using the selected wall-clock time rather than UTC midnight', () => {
  const result = inTimezone('America/Los_Angeles', `console.log(JSON.stringify(normalizePermissionExpiry('2026-10-05T10:22','datetime-local')));`);
  assert.equal(result, '2026-10-05T17:22:00.000Z');
});

test('date-only fields keep their previous UTC end-of-day semantics', () => {
  assert.equal(normalizePermissionExpiry('2026-10-05', 'date'), '2026-10-05T23:59:59.000Z');
  assert.equal(normalizePermissionExpiry('2028-02-29'), '2028-02-29T23:59:59.000Z');
});

test('invalid or nonexistent local date-times are rejected before granting permission', () => {
  for (const value of ['', '2026-02-30T10:00', '2026-10-05T24:00', '2026-10-05T10:00Z', '2026-10-05']) {
    assert.throws(() => normalizePermissionExpiry(value, 'datetime-local'), /valid local date and time/);
  }
  for (const value of ['', '2026-02-30', '2026-13-01', '2026-10-05T10:00']) {
    assert.throws(() => normalizePermissionExpiry(value, 'date'), /valid date/);
  }
  const result = inTimezone('America/Los_Angeles', `let message;try{normalizePermissionExpiry('2026-03-08T02:30','datetime-local')}catch(error){message=error.message}console.log(JSON.stringify(message));`);
  assert.match(result, /valid local date and time/);
});
