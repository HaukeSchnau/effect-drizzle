import { DrizzleQueryError } from "drizzle-orm/errors";
import { drizzle } from "drizzle-orm/node-postgres";
import type * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as pg from "pg";
import { DatabaseError as BaseDatabaseError } from "./common.js";
import { type DatabaseService, makeDatabaseService } from "./postgres.js";

export type { DatabaseService };
export type DatabaseError = BaseDatabaseError<pg.DatabaseError | Error>;
export { BaseDatabaseError };

const matchPgError = (error: unknown): DatabaseError | null => {
	if (error instanceof pg.DatabaseError) {
		switch (error.code) {
			case "23505":
				return new BaseDatabaseError({
					type: "unique_violation",
					cause: error,
				});
			case "23503":
				return new BaseDatabaseError({
					type: "foreign_key_violation",
					cause: error,
				});
			case "08000":
				return new BaseDatabaseError({
					type: "connection_error",
					cause: error,
				});
		}
	}

	if (error instanceof DrizzleQueryError) {
		if (error.cause instanceof AggregateError) {
			for (const cause of error.cause.errors) {
				if (cause.constructor.name === "ExceptionWithHostPort") {
					return new BaseDatabaseError({
						type: "connection_error",
						cause: cause,
					});
				}
			}
		}
	}
	return null;
};

export type Config<DbSchema extends Record<string, unknown>> = {
	url: Redacted.Redacted;
	ssl: boolean;
	schema: DbSchema;
};

export const makeService = <
	DbSchema extends Record<string, unknown>,
	DBTag extends Context.Tag<any, DatabaseService<DbSchema>>,
>(
	config: Config<DbSchema>,
	dbTag: DBTag,
) =>
	Effect.gen(function* () {
		const pool = yield* Effect.acquireRelease(
			Effect.sync(
				() =>
					new pg.Pool({
						connectionString: Redacted.value(config.url),
						ssl: config.ssl,
						idleTimeoutMillis: 0,
						connectionTimeoutMillis: 0,
					}),
			),
			(pool) => Effect.promise(() => pool.end()),
		);

		yield* Effect.tryPromise(() => pool.query("SELECT 1")).pipe(
			Effect.timeoutFail({
				duration: "10 seconds",
				onTimeout: () =>
					new BaseDatabaseError({
						type: "connection_error",
						cause: new Error("[Database] Failed to connect: timeout"),
					}),
			}),
			Effect.catchTag(
				"UnknownException",
				(error) =>
					new BaseDatabaseError({
						type: "connection_error",
						cause: error,
					}),
			),
			Effect.tap(() =>
				Effect.logInfo(
					"[Database client]: Connection to the database established.",
				),
			),
		);

		const setupConnectionListeners = Effect.zipRight(
			Effect.async<void, DatabaseError>((resume) => {
				pool.on("error", (error) => {
					resume(
						Effect.fail(
							new BaseDatabaseError({
								type: "connection_error",
								cause: error,
							}),
						),
					);
				});

				return Effect.sync(() => {
					pool.removeAllListeners("error");
				});
			}),
			Effect.logInfo(
				"[Database client]: Connection error listeners initialized.",
			),
			{
				concurrent: true,
			},
		);

		const db = drizzle(pool, { schema: config.schema });

		return makeDatabaseService(
			db,
			dbTag,
			matchPgError,
			setupConnectionListeners,
		);
	});
