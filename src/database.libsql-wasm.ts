import { LibsqlError } from "@libsql/client-wasm";
import { drizzle } from "drizzle-orm/libsql/wasm";
import { pipe } from "effect";
import * as Cause from "effect/Cause";
import type { Tag } from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Runtime from "effect/Runtime";
import { DatabaseError } from "./common";
import type {
	Execute,
	GenericSqliteClient,
	GenericSqliteError,
	MakeQuery,
	Transaction,
	TransactionClient,
	TransactionContextShape,
} from "./generic-sqlite";

const matchSqliteError = (error: unknown) => {
	if (error instanceof LibsqlError) {
		switch (error.code) {
			case "SQLITE_CONSTRAINT_UNIQUE":
				return new DatabaseError({ type: "unique_violation", cause: error });
			case "SQLITE_CONSTRAINT_FOREIGNKEY":
				return new DatabaseError({
					type: "foreign_key_violation",
					cause: error,
				});
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

export const makeService = <
	DbSchema extends Record<string, unknown>,
	TTransactionContextTag extends Tag<any, TransactionContextShape<DbSchema>>,
>(
	config: Config<DbSchema>,
	transactionContextTag: TTransactionContextTag,
) =>
	Effect.gen(function* () {
		const db = drizzle({
			connection: {
				url: Redacted.value(config.url),
			},
			schema: config.schema,
		});

		const execute: Execute<DbSchema> = Effect.fn(
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

		const transaction: Transaction<DbSchema, TTransactionContextTag> =
			Effect.fn("Database.transaction")(
				<T, E, R>(
					txExecute:
						| ((tx: Execute<DbSchema>) => Effect.Effect<T, E, R>)
						| Effect.Effect<T, E, R>,
				) =>
					Effect.runtime<Exclude<R, TTransactionContextTag>>().pipe(
						Effect.map((runtime) => Runtime.runPromiseExit(runtime)),
						Effect.flatMap((runPromiseExit) =>
							Effect.async<
								T,
								DatabaseError<GenericSqliteError> | E,
								Exclude<R, TTransactionContextTag>
							>((resume) => {
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
									const result = await runPromiseExit(
										pipe(
											typeof txExecute === "function"
												? txExecute(txWrapper)
												: txExecute,
											Effect.provideService(transactionContextTag, {
												execute: txWrapper,
											}),
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
								}).catch((cause) => {
									const error = matchSqliteError(cause);
									resume(
										error !== null ? Effect.fail(error) : Effect.die(cause),
									);
								});
							}),
						),
					),
			);

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
				return Effect.serviceOption(transactionContextTag).pipe(
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
	});
