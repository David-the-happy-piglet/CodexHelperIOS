export interface Logger {
  child(bindings: Record<string, unknown>): Logger;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

export class StructuredLogger implements Logger {
  constructor(private readonly bindings: Record<string, unknown> = {}) {}

  child(bindings: Record<string, unknown>): Logger {
    return new StructuredLogger({ ...this.bindings, ...bindings });
  }

  info(message: string, context: Record<string, unknown> = {}): void {
    this.log("info", message, context);
  }

  warn(message: string, context: Record<string, unknown> = {}): void {
    this.log("warn", message, context);
  }

  error(message: string, context: Record<string, unknown> = {}): void {
    this.log("error", message, context);
  }

  private log(level: string, message: string, context: Record<string, unknown>): void {
    const payload = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...this.bindings,
      ...context,
    };

    console.log(JSON.stringify(payload));
  }
}

