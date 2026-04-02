declare module 'sql.js' {
  type SqlValue = number | string | Uint8Array | null;

  interface QueryExecResult {
    columns: string[];
    values: SqlValue[][];
  }

  interface Database {
    run(sql: string, params?: SqlValue[]): Database;
    exec(sql: string, params?: SqlValue[]): QueryExecResult[];
    export(): Uint8Array;
    close(): void;
  }

  interface SqlJsStatic {
    Database: new (data?: ArrayLike<number> | Buffer | null) => Database;
  }

  export type { Database };

  function initSqlJs(config?: object): Promise<SqlJsStatic>;
  export default initSqlJs;
}
