import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { Effect, Redacted } from "effect";
import { factory } from "effect-drizzle/libsql-wasm";

const Schema = {
	todos: sqliteTable("todos", {
		id: integer("id").primaryKey(),
		title: text("title").notNull(),
		completed: integer("completed").notNull(),
		createdAt: integer("created_at").notNull(),
		updatedAt: integer("updated_at").notNull(),
	}),
};

const Database = factory<typeof Schema>();

const DatabaseLive = Database.layer({
	url: Redacted.make("file:local.db"),
	schema: Schema,
});

const program = Effect.gen(function* () {
	const db = yield* Database.Database;

	return yield* db.transaction(
		Effect.fnUntraced(function* (tx) {
			yield* tx((client) =>
				client.run(
					sql`CREATE TABLE IF NOT EXISTS todos (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, completed INTEGER, created_at INTEGER, updated_at INTEGER);`,
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
}).pipe(Effect.provide(DatabaseLive));

(async () => {
	const result = await Effect.runPromiseExit(program);

	document.body.innerHTML = `
        <pre>${JSON.stringify(result, null, 2)}</pre>
    `;
})();
