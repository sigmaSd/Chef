type LogListener = (msg: string) => void;

class Logger {
  private listeners: Set<LogListener> = new Set();
  private logs: string[] = [];
  private maxLogs = 1000;

  constructor() {
    this.wrapConsole();
  }

  private wrapConsole() {
    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;

    const formatArgs = (args: unknown[]): string => {
      if (typeof args[0] === "string" && args[0].includes("%c")) {
        let fmt = args[0];
        const count = (fmt.match(/%c/g) || []).length;
        fmt = fmt.replace(/%c/g, "");
        return [fmt, ...args.slice(count + 1)].map(String).join(" ");
      }
      return args.map(String).join(" ");
    };

    console.log = (...args: unknown[]) => {
      originalLog(...args);
      this.addLog(formatArgs(args));
    };

    console.error = (...args: unknown[]) => {
      originalError(...args);
      this.addLog(`ERROR: ${formatArgs(args)}`);
    };

    console.warn = (...args: unknown[]) => {
      originalWarn(...args);
      this.addLog(`WARN: ${formatArgs(args)}`);
    };
  }

  private addLog(msg: string) {
    const messageWithNewline = msg.endsWith("\n") ? msg : msg + "\n";
    this.logs.push(messageWithNewline);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
    for (const listener of this.listeners) {
      listener(messageWithNewline);
    }
  }

  addListener(listener: LogListener) {
    this.listeners.add(listener);
    // Send existing logs
    for (const log of this.logs) {
      listener(log);
    }
  }

  removeListener(listener: LogListener) {
    this.listeners.delete(listener);
  }

  getLogs(): string {
    return this.logs.join("");
  }
}

export const logger = new Logger();
