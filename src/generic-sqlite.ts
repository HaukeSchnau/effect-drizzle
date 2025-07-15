import type { ExtractTablesWithRelations } from "drizzle-orm";
import type {
	BaseSQLiteDatabase,
	SQLiteTransaction,
} from "drizzle-orm/sqlite-core";
import { Cause, Effect, Exit, Option, pipe, Runtime } from "effect";
import type { Tag } from "effect/Context";
import type { DatabaseError } from "./common.js";

export type GenericSqliteClient<TSchema extends Record<string, unknown>> =
	BaseSQLiteDatabase<"sync" | "async", unknown, TSchema>;

export type TransactionClient<TSchema extends Record<string, unknown>> =
	SQLiteTransaction<
		"sync" | "async",
		unknown,
		TSchema,
		ExtractTablesWithRelations<TSchema>
	>;

export type GenericSqliteError = {
	message: string;
};

export type Execute<DbSchema extends Record<string, unknown>> = <T>(
	fn: (
		client: GenericSqliteClient<DbSchema> | TransactionClient<DbSchema>,
	) => Promise<T>,
) => Effect.Effect<T, DatabaseError<GenericSqliteError>>;

export type Transaction<DbSchema extends Record<string, unknown>> = <T, E, R>(
	txExecute:
		| ((service: GenericDatabaseService<DbSchema>) => Effect.Effect<T, E, R>)
		| Effect.Effect<T, E, R>,
) => Effect.Effect<T, DatabaseError<GenericSqliteError> | E, R>;

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

export type GenericDatabaseService<DbSchema extends Record<string, unknown>> = {
	execute: Execute<DbSchema>;
	transaction: Transaction<DbSchema>;
	makeQuery: MakeQuery<DbSchema>;
};

export type { DatabaseError };

const ensurePromise = <T>(value: T | Promise<T>) =>
	value instanceof Promise ? value : Promise.resolve(value);

export const makeGenericDatabaseService = <
	DbSchema extends Record<string, unknown>,
	DBTag extends Tag<any, GenericDatabaseService<DbSchema>>,
>(
	db: GenericSqliteClient<DbSchema>,
	dbTag: DBTag,
	matchSqliteError: (
		error: unknown,
	) => DatabaseError<GenericSqliteError> | null,
): GenericDatabaseService<DbSchema> => {
	const makeExecute =
		(
			db: GenericSqliteClient<DbSchema> | TransactionClient<DbSchema>,
		): Execute<DbSchema> =>
		<T>(
			fn: (
				client: GenericSqliteClient<DbSchema> | TransactionClient<DbSchema>,
			) => Promise<T>,
		) =>
			Effect.tryPromise({
				try: () => fn(db),
				catch: (cause) => {
					const error = matchSqliteError(cause);
					if (error !== null) {
						return error;
					}
					throw cause;
				},
			});

	const execute: Execute<DbSchema> = makeExecute(db);

	const makeTransaction =
		(
			db: GenericSqliteClient<DbSchema> | TransactionClient<DbSchema>,
		): Transaction<DbSchema> =>
		<T, E, R>(
			txExecute:
				| ((
						service: GenericDatabaseService<DbSchema>,
				  ) => Effect.Effect<T, E, R>)
				| Effect.Effect<T, E, R>,
		) =>
			Effect.runtime<R>().pipe(
				Effect.map((runtime) => Runtime.runPromiseExit(runtime)),
				Effect.flatMap((runPromiseExit) =>
					Effect.async<T, DatabaseError<GenericSqliteError> | E, R>(
						(resume) => {
							ensurePromise(
								db.transaction(async (tx: TransactionClient<DbSchema>) => {
									const service = {
										execute: makeExecute(tx),
										transaction: makeTransaction(tx),
										makeQuery,
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
								const error = matchSqliteError(cause);
								resume(error !== null ? Effect.fail(error) : Effect.die(cause));
							});
						},
					),
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
	} as const;
};
