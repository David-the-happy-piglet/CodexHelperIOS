export function nowISO(): string {
  return new Date().toISOString();
}

export function elapsedSeconds(startedAt: string, referenceDate = new Date()): number {
  const started = new Date(startedAt).getTime();
  return Math.max(0, Math.floor((referenceDate.getTime() - started) / 1000));
}

export function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

