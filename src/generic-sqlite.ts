import type { ExtractTablesWithRelations } from "drizzle-orm";
import type {
	BaseSQLiteDatabase,
	SQLiteTransaction,
} from "drizzle-orm/sqlite-core";
import { Context, Effect } from "effect";
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

export type TransactionContextShape<TSchema extends Record<string, unknown>> = <
	U,
>(
	fn: (client: TransactionClient<TSchema>) => Promise<U>,
) => Effect.Effect<U, DatabaseError<GenericSqliteError>>;

export const transactionContextFactory = <
	TSchema extends Record<string, unknown>,
>() =>
	class TransactionContext extends Context.Tag("TransactionContext")<
		TransactionContext,
		TransactionContextShape<TSchema>
	>() {
		public static readonly provide = (
			transaction: TransactionContextShape<TSchema>,
		): (<A, E, R>(
			self: Effect.Effect<A, E, R>,
		) => Effect.Effect<A, E, Exclude<R, TransactionContext>>) =>
			Effect.provideService(this, transaction);
	};
export type TransactionContext<TSchema extends Record<string, unknown>> =
	ReturnType<typeof transactionContextFactory<TSchema>>;

type Execute<DbSchema extends Record<string, unknown>> = <T>(
	fn: (client: GenericSqliteClient<DbSchema>) => Promise<T>,
) => Effect.Effect.AsEffect<
	Effect.Effect<T, DatabaseError<GenericSqliteError>, never>
>;

type Transaction<DbSchema extends Record<string, unknown>> = <T, E, R>(
	txExecute: (tx: TransactionContextShape<DbSchema>) => Effect.Effect<T, E, R>,
) => Effect.Effect.AsEffect<
	Effect.Effect<T, DatabaseError<GenericSqliteError> | E, R>
>;

type ExecuteFn<DbSchema extends Record<string, unknown>> = <T>(
	fn: (
		client: GenericSqliteClient<DbSchema> | TransactionClient<DbSchema>,
	) => Promise<T>,
) => Effect.Effect<T, DatabaseError<GenericSqliteError>>;

type MakeQuery<DbSchema extends Record<string, unknown>> = <
	A,
	E,
	R,
	Input = never,
>(
	queryFn: (
		execute: ExecuteFn<DbSchema>,
		input: Input,
	) => Effect.Effect<A, E, R>,
) => (
	...args: [Input] extends [never] ? [] : [input: Input]
) => Effect.Effect<A, E, R>;

export type GenericDatabaseService<DbSchema extends Record<string, unknown>> = {
	execute: Execute<DbSchema>;
	transaction: Transaction<DbSchema>;
	makeQuery: MakeQuery<DbSchema>;
};

const databaseFactory = <DbSchema extends Record<string, unknown>>() =>
	class Database extends Effect.Tag("Database")<
		Database,
		GenericDatabaseService<DbSchema>
	>() {};

export const genericDatabaseFactory = <
	DbSchema extends Record<string, unknown>,
>() => {
	const transactionContext = transactionContextFactory<DbSchema>();
	const database = databaseFactory<DbSchema>();

	return {
		TransactionContext: transactionContext,
		Database: database,
	};
};

export type { DatabaseError };
