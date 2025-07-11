import { Database as BunDatabase, SQLiteError } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { Effect } from "effect";
import type { Tag } from "effect/Context";
import * as Redacted from "effect/Redacted";
import { DatabaseError } from "./common";
import {
	type GenericDatabaseService,
	makeGenericDatabaseService,
} from "./generic-sqlite";

const matchSqliteError = (error: unknown) => {
	if (error instanceof SQLiteError) {
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
	DBTag extends Tag<any, GenericDatabaseService<DbSchema>>,
>(
	config: Config<DbSchema>,
	dbTag: DBTag,
) =>
	Effect.gen(function* () {
		const connection = yield* Effect.acquireRelease(
			Effect.sync(() => new BunDatabase(Redacted.value(config.url))),
			(connection) => Effect.sync(() => connection.close()),
		);

		const db = drizzle(connection, { schema: config.schema });

		return makeGenericDatabaseService(db, dbTag, matchSqliteError);
	});
