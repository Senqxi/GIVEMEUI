declare module "sql.js" {
  export type QueryExecResult = {
    columns: string[];
    values: unknown[][];
  };

  export type Statement = {
    bind(values?: unknown[] | Record<string, unknown>): boolean;
    free(): void;
    get(): unknown[];
    getAsObject(values?: unknown[] | Record<string, unknown>): Record<string, unknown>;
    run(values?: unknown[] | Record<string, unknown>): void;
    step(): boolean;
  };

  export type Database = {
    close(): void;
    exec(sql: string, params?: unknown[]): QueryExecResult[];
    export(): Uint8Array;
    prepare(sql: string, params?: unknown[]): Statement;
    run(sql: string, params?: unknown[]): Database;
  };

  export type SqlJsStatic = {
    Database: new (data?: Uint8Array | Buffer) => Database;
  };

  export default function initSqlJs(config?: { locateFile?: (file: string) => string }): Promise<SqlJsStatic>;
}
