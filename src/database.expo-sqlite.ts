import { drizzle } from "drizzle-orm/expo-sqlite";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Runtime from "effect/Runtime";
import { openDatabaseSync } from "expo-sqlite";
import type { DatabaseError } from "./common";
import {
	type GenericSqliteClient,
	type GenericSqliteError,
	type TransactionClient,
	type TransactionContext,
	type TransactionContextShape,
	transactionContextFactory,
} from "./generic-sqlite";

const matchSqliteError = (error: unknown) => {
	if (error instanceof Error) {
		console.error("TODO: matchSqliteError", error);
	}
	return null;
};

export type Config<DbSchema extends Record<string, unknown>> = {
	url: Redacted.Redacted;
	schema: DbSchema;
};

export const makeService = <DbSchema extends Record<string, unknown>>(
	config: Config<DbSchema>,
	transactionContext: TransactionContext<DbSchema>,
) =>
	Effect.gen(function* () {
		const connection = yield* Effect.acquireRelease(
			Effect.sync(() => openDatabaseSync(Redacted.value(config.url))),
			(connection) => Effect.sync(() => connection.closeSync()),
		);

		const db = drizzle(connection, { schema: config.schema });

		const execute = Effect.fn(
			<T>(fn: (client: GenericSqliteClient<DbSchema>) => Promise<T>) =>
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
			<T, E, R>(
				txExecute: (
					tx: TransactionContextShape<DbSchema>,
				) => Effect.Effect<T, E, R>,
			) =>
				Effect.runtime<R>().pipe(
					Effect.map((runtime) => Runtime.runPromiseExit(runtime)),
					Effect.flatMap((runPromiseExit) =>
						Effect.async<T, DatabaseError<Error> | E, R>((resume) => {
							db.transaction(async (tx: TransactionClient<DbSchema>) => {
								const txWrapper = (
									fn: (client: TransactionClient<DbSchema>) => Promise<any>,
								) =>
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
			fn: (
				client: GenericSqliteClient<DbSchema> | TransactionClient<DbSchema>,
			) => Promise<T>,
		) => Effect.Effect<T, DatabaseError<GenericSqliteError>>;
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
			makeQuery,
		} as const;
	});

type Shape<DbSchema extends Record<string, unknown>> = Effect.Effect.Success<
	ReturnType<typeof makeService<DbSchema>>
>;

const databaseFactory = <DbSchema extends Record<string, unknown>>() =>
	class Database extends Effect.Tag("Database")<Database, Shape<DbSchema>>() {};

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
