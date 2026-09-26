export async function emit(work: () => Promise<unknown>): Promise<void> {
  try {
    console.log(JSON.stringify(await work(), null, 2));
  } catch (error) {
    console.log(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2));
    process.exit(1);
  }
}

export function usageError(usage: string): never {
  console.error(usage);
  process.exit(2);
}

export function wholeNumber(value: string | undefined, name: string): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw new Error(`--${name} must be a whole number, not ${value}`);
  return number;
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}
