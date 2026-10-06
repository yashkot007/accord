const pad = (value: number) => String(value).padStart(2, '0');

/** A local wall-clock value for a datetime-local input, including seconds. */
export function formatLocalDateTime(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, '0')}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** Keep the previous 30-day, UTC end-of-day default, displayed in local time. */
export function defaultPermissionExpiry(timestamp = Date.now()): string {
  const day = new Date(timestamp + 30 * 86400000).toISOString().slice(0, 10);
  return formatLocalDateTime(new Date(`${day}T23:59:59Z`));
}

export function normalizePermissionExpiry(value: string, inputType = 'date'): string {
  if (inputType === 'date') {
    const date = new Date(`${value}T23:59:59Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
      throw new Error('Choose a valid date for permission expiry.');
    }
    return date.toISOString();
  }
  const date = new Date(value);
  const expected = value.length === 16 ? `${value}:00` : value;
  // The round-trip rejects rolled-over dates and nonexistent daylight-saving times.
  if (inputType !== 'datetime-local' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value) || Number.isNaN(date.getTime()) || formatLocalDateTime(date) !== expected) {
    throw new Error('Choose a valid local date and time for permission expiry.');
  }
  return date.toISOString();
}
