import type { ExtractTablesWithRelations } from "drizzle-orm";
import {
	drizzle,
	type NodePgDatabase,
	type NodePgQueryResultHKT,
} from "drizzle-orm/node-postgres";
import type { PgTransaction } from "drizzle-orm/pg-core";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Runtime from "effect/Runtime";
import * as pg from "pg";
import { DatabaseConnectionLostError, DatabaseError } from "./common";

type TransactionClient<DbSchema extends Record<string, unknown>> =
	PgTransaction<
		NodePgQueryResultHKT,
		DbSchema,
		ExtractTablesWithRelations<DbSchema>
	>;

type Client<DbSchema extends Record<string, unknown>> =
	NodePgDatabase<DbSchema> & {
		$client: pg.Pool;
	};

type TransactionContextShape<DbSchema extends Record<string, unknown>> = <U>(
	fn: (client: TransactionClient<DbSchema>) => Promise<U>,
) => Effect.Effect<U, DatabaseError<pg.DatabaseError>>;

const transactionContextFactory = <
	DbSchema extends Record<string, unknown>,
>() =>
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
	};
type TransactionContext<DbSchema extends Record<string, unknown>> = ReturnType<
	typeof transactionContextFactory<DbSchema>
>;

const matchPgError = (error: unknown) => {
	if (error instanceof pg.DatabaseError) {
		switch (error.code) {
			case "23505":
				return new DatabaseError({ type: "unique_violation", cause: error });
			case "23503":
				return new DatabaseError({
					type: "foreign_key_violation",
					cause: error,
				});
			case "08000":
				return new DatabaseError({ type: "connection_error", cause: error });
		}
	}
	return null;
};

export type Config<DbSchema extends Record<string, unknown>> = {
	url: Redacted.Redacted;
	ssl: boolean;
	schema: DbSchema;
};

const makeService = <DbSchema extends Record<string, unknown>>(
	config: Config<DbSchema>,
	transactionContext: TransactionContext<DbSchema>,
) =>
	Effect.gen(function* () {
		const pool = yield* Effect.acquireRelease(
			Effect.sync(
				() =>
					new pg.Pool({
						connectionString: Redacted.value(config.url),
						ssl: config.ssl,
						idleTimeoutMillis: 0,
						connectionTimeoutMillis: 0,
					}),
			),
			(pool) => Effect.promise(() => pool.end()),
		);

		yield* Effect.tryPromise(() => pool.query("SELECT 1")).pipe(
			Effect.timeoutFail({
				duration: "10 seconds",
				onTimeout: () =>
					new DatabaseConnectionLostError({
						cause: new Error("[Database] Failed to connect: timeout"),
						message: "[Database] Failed to connect: timeout",
					}),
			}),
			Effect.catchTag(
				"UnknownException",
				(error) =>
					new DatabaseConnectionLostError({
						cause: error.cause,
						message: "[Database] Failed to connect",
					}),
			),
			Effect.tap(() =>
				Effect.logInfo(
					"[Database client]: Connection to the database established.",
				),
			),
		);

		const setupConnectionListeners = Effect.zipRight(
			Effect.async<void, DatabaseConnectionLostError>((resume) => {
				pool.on("error", (error) => {
					resume(
						Effect.fail(
							new DatabaseConnectionLostError({
								cause: error,
								message: error.message,
							}),
						),
					);
				});

				return Effect.sync(() => {
					pool.removeAllListeners("error");
				});
			}),
			Effect.logInfo(
				"[Database client]: Connection error listeners initialized.",
			),
			{
				concurrent: true,
			},
		);

		const db = drizzle(pool, { schema: config.schema });

		const execute = Effect.fn(
			<T>(fn: (client: Client<DbSchema>) => Promise<T>) =>
				Effect.tryPromise({
					try: () => fn(db),
					catch: (cause) => {
						const error = matchPgError(cause);
						if (error !== null) {
							return error;
						}
						throw cause;
					},
				}),
		);

		const transaction = Effect.fn("Database.transaction")(
			<T, E, R>(
				txExecute: (
					tx: TransactionContextShape<DbSchema>,
				) => Effect.Effect<T, E, R>,
			) =>
				Effect.runtime<R>().pipe(
					Effect.map((runtime) => Runtime.runPromiseExit(runtime)),
					Effect.flatMap((runPromiseExit) =>
						Effect.async<T, DatabaseError<pg.DatabaseError> | E, R>(
							(resume) => {
								db.transaction(async (tx: TransactionClient<DbSchema>) => {
									const txWrapper = (
										fn: (client: TransactionClient<DbSchema>) => Promise<any>,
									) =>
										Effect.tryPromise({
											try: () => fn(tx),
											catch: (cause) => {
												const error = matchPgError(cause);
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
									const error = matchPgError(cause);
									resume(
										error !== null ? Effect.fail(error) : Effect.die(cause),
									);
								});
							},
						),
					),
				),
		);

		type ExecuteFn = <T>(
			fn: (
				client: Client<DbSchema> | TransactionClient<DbSchema>,
			) => Promise<T>,
		) => Effect.Effect<T, DatabaseError<pg.DatabaseError>>;
		const makeQuery =
			<A, E, R, Input = never>(
				queryFn: (execute: ExecuteFn, input: Input) => Effect.Effect<A, E, R>,
			) =>
			(
				...args: [Input] extends [never] ? [] : [input: Input]
			): Effect.Effect<A, E, R> => {
				const input = args[0] as Input;
				return Effect.serviceOption(transactionContext).pipe(
					Effect.map(Option.getOrNull),
					Effect.flatMap((txOrNull) => queryFn(txOrNull ?? execute, input)),
				);
			};

		return {
			execute,
			transaction,
			setupConnectionListeners,
			makeQuery,
		} as const;
	});

export type PostgresDatabaseService<DbSchema extends Record<string, unknown>> =
	Effect.Effect.Success<ReturnType<typeof makeService<DbSchema>>>;

const databaseFactory = <DbSchema extends Record<string, unknown>>() =>
	class Database extends Effect.Tag("Database")<
		Database,
		PostgresDatabaseService<DbSchema>
	>() {};

export const factory = <DbSchema extends Record<string, unknown>>() => {
	const transactionContext = transactionContextFactory<DbSchema>();
	const database = databaseFactory<DbSchema>();

	return {
		TransactionContext: transactionContext,
		Database: database,
		layer: (config: Config<DbSchema>) =>
			Layer.scoped(database, makeService(config, transactionContext)),
	};
};
