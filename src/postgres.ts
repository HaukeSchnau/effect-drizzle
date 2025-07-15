import type { ExtractTablesWithRelations } from "drizzle-orm";
import type {
	NodePgDatabase,
	NodePgQueryResultHKT,
} from "drizzle-orm/node-postgres";
import type { PgTransaction } from "drizzle-orm/pg-core";
import { Cause, Effect, Exit, Option, pipe, Runtime } from "effect";
import type { Tag } from "effect/Context";
import type pg from "pg";
import type { DatabaseConnectionLostError, DatabaseError } from "./common.js";

type Client<DbSchema extends Record<string, unknown>> =
	NodePgDatabase<DbSchema> & {
		$client: pg.Pool;
	};

type TransactionClient<DbSchema extends Record<string, unknown>> =
	PgTransaction<
		NodePgQueryResultHKT,
		DbSchema,
		ExtractTablesWithRelations<DbSchema>
	>;

export type Execute<DbSchema extends Record<string, unknown>> = <T>(
	fn: (client: Client<DbSchema> | TransactionClient<DbSchema>) => Promise<T>,
) => Effect.Effect<T, DatabaseError<pg.DatabaseError>>;

export type Transaction<DbSchema extends Record<string, unknown>> = <T, E, R>(
	txExecute:
		| ((service: DatabaseService<DbSchema>) => Effect.Effect<T, E, R>)
		| Effect.Effect<T, E, R>,
) => Effect.Effect<T, DatabaseError<pg.DatabaseError> | E, R>;

export type MakeQuery<DbSchema extends Record<string, unknown>> = <
	A,
	E,
	R,
	Input = never,
>(
	queryFn: (execute: Execute<DbSchema>, input: Input) => Effect.Effect<A, E, R>,
) => (
	...args: [Input] extends [never] ? [] : [input: Input]
) => Effect.Effect<A, E, R>;

export type DatabaseService<DbSchema extends Record<string, unknown>> = {
	execute: Execute<DbSchema>;
	transaction: Transaction<DbSchema>;
	makeQuery: MakeQuery<DbSchema>;
	setupConnectionListeners: Effect.Effect<void, DatabaseConnectionLostError>;
};

export type { DatabaseError };

const ensurePromise = <T>(value: T | Promise<T>) =>
	value instanceof Promise ? value : Promise.resolve(value);

export const makeDatabaseService = <
	DbSchema extends Record<string, unknown>,
	DBTag extends Tag<any, DatabaseService<DbSchema>>,
>(
	db: Client<DbSchema>,
	dbTag: DBTag,
	matchPgError: (error: unknown) => DatabaseError<pg.DatabaseError> | null,
	setupConnectionListeners: Effect.Effect<void, DatabaseConnectionLostError>,
): DatabaseService<DbSchema> => {
	const makeExecute =
		(db: Client<DbSchema> | TransactionClient<DbSchema>): Execute<DbSchema> =>
		<T>(
			fn: (
				client: Client<DbSchema> | TransactionClient<DbSchema>,
			) => Promise<T>,
		) =>
			Effect.tryPromise({
				try: () => fn(db),
				catch: (cause) => {
					const error = matchPgError(cause);
					if (error !== null) {
						return error;
					}
					throw cause;
				},
			});

	const execute: Execute<DbSchema> = makeExecute(db);

	const makeTransaction =
		(
			db: Client<DbSchema> | TransactionClient<DbSchema>,
		): Transaction<DbSchema> =>
		<T, E, R>(
			txExecute:
				| ((service: DatabaseService<DbSchema>) => Effect.Effect<T, E, R>)
				| Effect.Effect<T, E, R>,
		) =>
			Effect.runtime<R>().pipe(
				Effect.map((runtime) => Runtime.runPromiseExit(runtime)),
				Effect.flatMap((runPromiseExit) =>
					Effect.async<T, DatabaseError<pg.DatabaseError> | E, R>((resume) => {
						ensurePromise(
							db.transaction(async (tx: TransactionClient<DbSchema>) => {
								const service = {
									execute: makeExecute(tx),
									transaction: makeTransaction(tx),
									makeQuery,
									setupConnectionListeners,
								};

								const result = await runPromiseExit(
									pipe(
										typeof txExecute === "function"
											? txExecute(service)
											: txExecute,
										Effect.provideService(dbTag, service),
									),
								);
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
							}),
						).catch((cause) => {
							const error = matchPgError(cause);
							resume(error !== null ? Effect.fail(error) : Effect.die(cause));
						});
					}),
				),
			);

	const transaction: Transaction<DbSchema> = makeTransaction(db);

	const makeQuery: MakeQuery<DbSchema> =
		<A, E, R, Input = never>(
			queryFn: (
				execute: Execute<DbSchema>,
				input: Input,
			) => Effect.Effect<A, E, R>,
		) =>
		(
			...args: [Input] extends [never] ? [] : [input: Input]
		): Effect.Effect<A, E, R> => {
			const input = args[0] as Input;
			return Effect.serviceOption(dbTag).pipe(
				Effect.map(Option.getOrNull),
				Effect.flatMap((txOrNull) =>
					queryFn(txOrNull?.execute ?? execute, input),
				),
			);
		};

	return {
		execute,
		transaction,
		makeQuery,
		setupConnectionListeners,
	} as const;
};
