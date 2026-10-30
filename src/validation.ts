export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Parses `text` as JSON, or returns undefined if it isn't JSON. */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function checkNumber(
  name: string,
  value: unknown,
  valid: (value: number) => boolean,
  expected: string,
): number {
  if (typeof value !== 'number' || !valid(value)) {
    throw new RangeError(`${name} must be ${expected}, not ${String(value)}`);
  }
  return value;
}
