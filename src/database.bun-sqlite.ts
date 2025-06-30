import { type ExtractTablesWithRelations } from "drizzle-orm";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Runtime from "effect/Runtime";
import { Database as BunDatabase, SQLiteError } from 'bun:sqlite';
import { BunSQLiteDatabase, SQLiteBunTransaction, drizzle } from "drizzle-orm/bun-sqlite";
import { DatabaseError } from "./common";

type TransactionClient<DbSchema extends Record<string, unknown>> = SQLiteBunTransaction<
  DbSchema,
  ExtractTablesWithRelations<DbSchema>
>;

type Client<DbSchema extends Record<string, unknown>> = BunSQLiteDatabase<DbSchema> & {
  $client: BunDatabase;
};

type TransactionContextShape<DbSchema extends Record<string, unknown>> = <U>(
  fn: (client: TransactionClient<DbSchema>) => Promise<U>,
) => Effect.Effect<U, DatabaseError<SQLiteError>>;

const transactionContextFactory = <DbSchema extends Record<string, unknown>>() =>
  class TransactionContext extends Context.Tag("TransactionContext")<
  TransactionContext,
  TransactionContextShape<DbSchema>
>() {
  public static readonly provide = (
    transaction: TransactionContextShape<DbSchema>,
  ): (<A, E, R>(
    self: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, Exclude<R, TransactionContext>>) =>
    Effect.provideService(this, transaction);
}
type TransactionContext<DbSchema extends Record<string, unknown>> = ReturnType<typeof transactionContextFactory<DbSchema>>;

const matchSqliteError = (error: unknown) => {
  if (error instanceof SQLiteError) {
    switch (error.code) {
      case "SQLITE_CONSTRAINT_UNIQUE":
        return new DatabaseError({ type: "unique_violation", cause: error });
      case "SQLITE_CONSTRAINT_FOREIGNKEY":
        return new DatabaseError({ type: "foreign_key_violation", cause: error });
      case "SQLITE_BUSY":
        return new DatabaseError({ type: "connection_error", cause: error });
    }
  }
  return null;
};

export type Config<DbSchema extends Record<string, unknown>> = {
  url: Redacted.Redacted;
  schema: DbSchema;
};

const makeService = <DbSchema extends Record<string, unknown>>(config: Config<DbSchema>, transactionContext: TransactionContext<DbSchema>) =>
  Effect.gen(function* () {
    const connection = yield* Effect.acquireRelease(
      Effect.sync(
        () =>
          new BunDatabase(Redacted.value(config.url)),
      ),
      (connection) => Effect.sync(() => connection.close()),
    );

    const db = drizzle(connection, { schema: config.schema });

    const execute = Effect.fn(<T>(fn: (client: Client<DbSchema>) => Promise<T>) =>
      Effect.tryPromise({
        try: () => fn(db),
        catch: (cause) => {
          const error = matchSqliteError(cause);
          if (error !== null) {
            return error;
          }
          throw cause;
        },
      }),
    );

    const transaction = Effect.fn("Database.transaction")(
      <T, E, R>(txExecute: (tx: TransactionContextShape<DbSchema>) => Effect.Effect<T, E, R>) =>
        Effect.runtime<R>().pipe(
          Effect.map((runtime) => Runtime.runPromiseExit(runtime)),
          Effect.flatMap((runPromiseExit) =>
            Effect.async<T, DatabaseError<SQLiteError> | E, R>((resume) => {
              db.transaction(async (tx: TransactionClient<DbSchema>) => {
                const txWrapper = (fn: (client: TransactionClient<DbSchema>) => Promise<any>) =>
                  Effect.tryPromise({
                    try: () => fn(tx),
                    catch: (cause) => {
                      const error = matchSqliteError(cause);
                      if (error !== null) {
                        return error;
                      }
                      throw cause;
                    },
                  });

                const result = await runPromiseExit(txExecute(txWrapper));
                Exit.match(result, {
                  onSuccess: (value) => {
                    resume(Effect.succeed(value));
                  },
                  onFailure: (cause) => {
                    if (Cause.isFailure(cause)) {
                      resume(Effect.fail(Cause.originalError(cause) as E));
                    } else {
                      resume(Effect.die(cause));
                    }
                  },
                });
              }).catch((cause) => {
                const error = matchSqliteError(cause);
                resume(error !== null ? Effect.fail(error) : Effect.die(cause));
              });
            }),
          ),
        ),
    );

    type ExecuteFn = <T>(
      fn: (client: Client<DbSchema> | TransactionClient<DbSchema>) => Promise<T>,
    ) => Effect.Effect<T, DatabaseError<SQLiteError>>;
    const makeQuery =
      <A, E, R, Input = never>(
        queryFn: (execute: ExecuteFn, input: Input) => Effect.Effect<A, E, R>,
      ) =>
      (...args: [Input] extends [never] ? [] : [input: Input]): Effect.Effect<A, E, R> => {
        const input = args[0] as Input;
        return Effect.serviceOption(transactionContext).pipe(
          Effect.map(Option.getOrNull),
          Effect.flatMap((txOrNull) => queryFn(txOrNull ?? execute, input)),
        );
      };

    return {
      execute,
      transaction,
      makeQuery,
    } as const;
  });

type Shape<DbSchema extends Record<string, unknown>> = Effect.Effect.Success<ReturnType<typeof makeService<DbSchema>>>;

const databaseFactory = <DbSchema extends Record<string, unknown>>() =>
  class Database extends Effect.Tag("Database")<Database, Shape<DbSchema>>() {}

export const factory = <DbSchema extends Record<string, unknown>>() => {
  const transactionContext = transactionContextFactory<DbSchema>();
  const database = databaseFactory<DbSchema>();
  
  return {
    TransactionContext: transactionContext,
    Database: database,
    layer: (config: Config<DbSchema>) => Layer.scoped(database, makeService(config, transactionContext)),
  }
}
