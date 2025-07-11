import { LibsqlError } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import type { Tag } from "effect/Context";
import * as Redacted from "effect/Redacted";
import { DatabaseError } from "./common";
import {
	type GenericDatabaseService,
	makeGenericDatabaseService,
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
	DBTag extends Tag<any, GenericDatabaseService<DbSchema>>,
>(
	config: Config<DbSchema>,
	dbTag: DBTag,
) => {
	const db = drizzle({
		connection: {
			url: Redacted.value(config.url),
		},
		schema: config.schema,
	});

	return makeGenericDatabaseService(db, dbTag, matchSqliteError);
};
