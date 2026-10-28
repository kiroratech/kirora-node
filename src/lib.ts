/** Returns `value` if it's a number `valid` accepts, or throws a RangeError naming it. */
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
