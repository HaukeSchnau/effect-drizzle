import type { ExtractTablesWithRelations } from "drizzle-orm";
import type {
	BaseSQLiteDatabase,
	SQLiteTransaction,
} from "drizzle-orm/sqlite-core";
import type { Effect } from "effect";
import type { DatabaseError } from "./common";

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

export type TransactionContextShape<TSchema extends Record<string, unknown>> = {
	execute: Execute<TSchema>;
};

export type Execute<DbSchema extends Record<string, unknown>> = <T>(
	fn: (
		client: GenericSqliteClient<DbSchema> | TransactionClient<DbSchema>,
	) => Promise<T>,
) => Effect.Effect<T, DatabaseError<GenericSqliteError>>;

export type Transaction<
	DbSchema extends Record<string, unknown>,
	TTransactionContextTag,
> = <T, E, R>(
	txExecute:
		| ((tx: Execute<DbSchema>) => Effect.Effect<T, E, R>)
		| Effect.Effect<T, E, R>,
) => Effect.Effect<
	T,
	DatabaseError<GenericSqliteError> | E,
	Exclude<R, TTransactionContextTag>
>;

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

export type GenericDatabaseService<
	DbSchema extends Record<string, unknown>,
	TTransactionContextTag,
> = {
	execute: Execute<DbSchema>;
	transaction: Transaction<DbSchema, TTransactionContextTag>;
	makeQuery: MakeQuery<DbSchema>;
};

export type { DatabaseError };
