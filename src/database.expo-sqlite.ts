import { drizzle } from "drizzle-orm/expo-sqlite";
import { Effect } from "effect";
import type { Tag } from "effect/Context";
import * as Redacted from "effect/Redacted";
import { openDatabaseSync } from "expo-sqlite";
import {
	type GenericDatabaseService,
	makeGenericDatabaseService,
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

export const makeService = <
	DbSchema extends Record<string, unknown>,
	DBTag extends Tag<any, GenericDatabaseService<DbSchema>>,
>(
	config: Config<DbSchema>,
	dbTag: DBTag,
) =>
	Effect.gen(function* () {
		const connection = yield* Effect.acquireRelease(
			Effect.sync(() => openDatabaseSync(Redacted.value(config.url))),
			(connection) => Effect.sync(() => connection.closeSync()),
		);

		const db = drizzle(connection, { schema: config.schema });

		return makeGenericDatabaseService(db, dbTag, matchSqliteError);
	});
