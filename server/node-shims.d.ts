declare const process: {
  env: Record<string, string | undefined>;
  cwd(): string;
};

declare const localStorage: {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

declare const console: {
  log(message?: unknown, ...optionalParams: unknown[]): void;
};

declare function setTimeout(callback: () => void, delay: number): unknown;
declare function clearTimeout(timeoutId: unknown): void;

declare const AbortSignal: {
  timeout(milliseconds: number): AbortSignal;
};

type AbortSignal = unknown;

declare function fetch(
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  }
): Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

declare module "node:http" {
  export type IncomingMessage = {
    method?: string;
    url?: string;
    on(event: "data", callback: (chunk: { toString(): string }) => void): void;
    on(event: "end", callback: () => void): void;
    on(event: "error", callback: (error: Error) => void): void;
    on(event: "close", callback: () => void): void;
  };

  export type ServerResponse = {
    writeHead(statusCode: number, headers: Record<string, string>): void;
    write(chunk: string): void;
    end(chunk?: string | Uint8Array): void;
  };

  export function createServer(
    handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
  ): {
    listen(port: number, host: string, callback: () => void): void;
  };
}

declare module "node:child_process" {
  type ChildProcess = {
    stdout?: { on(event: "data", callback: (chunk: { toString(): string }) => void): void };
    stderr?: { on(event: "data", callback: (chunk: { toString(): string }) => void): void };
    killed: boolean;
    kill(signal: string): void;
    on(event: "error", callback: (error: Error) => void): void;
    on(event: "close", callback: (exitCode: number | null, signal: string | null) => void): void;
  };

  export function spawn(
    executable: string,
    args: string[],
    options: {
      cwd?: string;
      shell: false;
      env: Record<string, string | undefined>;
    }
  ): ChildProcess;
}

declare module "node:fs" {
  export const constants: {
    X_OK: number;
  };
  export function accessSync(path: string, mode?: number): void;
  export function existsSync(path: string): boolean;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
  export function readFileSync(path: string): Uint8Array;
  export function rmSync(path: string, options?: { force?: boolean; recursive?: boolean }): void;
  export function statSync(path: string): {
    isFile(): boolean;
    isDirectory(): boolean;
  };
  export function writeFileSync(path: string, data: string | Uint8Array): void;
}

declare module "node:os" {
  export function homedir(): string;
}

declare module "node:path" {
  export const delimiter: string;
  export const sep: string;
  export function dirname(path: string): string;
  export function extname(path: string): string;
  export function isAbsolute(path: string): boolean;
  export function join(...paths: string[]): string;
  export function normalize(path: string): string;
  export function relative(from: string, to: string): string;
  export function resolve(...paths: string[]): string;
}

declare module "node:perf_hooks" {
  export const performance: {
    now(): number;
  };
}
