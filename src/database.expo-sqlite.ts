import { drizzle } from "drizzle-orm/expo-sqlite";
import { Effect } from "effect";
import type { Tag } from "effect/Context";
import * as Redacted from "effect/Redacted";
import { openDatabaseSync, type SQLiteDatabase } from "expo-sqlite";
import {
	type GenericDatabaseService,
	makeGenericDatabaseService,
} from "./generic-sqlite.js";

const matchSqliteError = (error: unknown) => {
	if (error instanceof Error) {
		console.error("TODO: matchSqliteError", error);
	}
	return null;
};

export type Config<DbSchema extends Record<string, unknown>> = {
	// url: Redacted.Redacted;
	schema: DbSchema;
} & (
	| {
			url: Redacted.Redacted;
			connection?: never;
	  }
	| {
			connection: SQLiteDatabase;
			url?: never;
	  }
);

export const makeService = <
	DbSchema extends Record<string, unknown>,
	DBTag extends Tag<any, GenericDatabaseService<DbSchema>>,
>(
	config: Config<DbSchema>,
	dbTag: DBTag,
) =>
	Effect.gen(function* () {
		const connection =
			config.connection ??
			(yield* Effect.acquireRelease(
				Effect.sync(() => openDatabaseSync(Redacted.value(config.url))),
				(connection) => Effect.sync(() => connection.closeSync()),
			));

		connection.execSync("PRAGMA journal_mode = WAL;");
		connection.execSync("PRAGMA synchronous = NORMAL;");
		connection.execSync("PRAGMA foreign_keys = ON;");
		connection.execSync("PRAGMA temp_store = MEMORY;");
		connection.execSync("PRAGMA busy_timeout = 5000;");
		connection.execSync("PRAGMA auto_vacuum = INCREMENTAL;");

		const db = drizzle(connection, { schema: config.schema });

		return makeGenericDatabaseService(db, dbTag, matchSqliteError);
	});
