import { sql } from "drizzle-orm";
import { Effect } from "effect";
import { Database, Schema } from "./contract";

const ensurePromise = <T>(value: T | Promise<T>) =>
	value instanceof Promise ? value : Promise.resolve(value);

export const sampleEffect = Effect.gen(function* () {
	const db = yield* Database.Database;

	return yield* db.transaction(
		Effect.fnUntraced(function* (tx) {
			yield* tx((client) =>
				ensurePromise(
					client.run(
						sql`CREATE TABLE IF NOT EXISTS todos (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, completed INTEGER, created_at INTEGER, updated_at INTEGER);`,
					),
				),
			);

			yield* tx((client) =>
				client.insert(Schema.todos).values({
					title: "Do something",
					completed: 0,
					createdAt: Date.now(),
					updatedAt: Date.now(),
				}),
			);

			const result = yield* tx((client) => client.select().from(Schema.todos));

			yield* Effect.log(result);

			return result;
		}),
	);
});
