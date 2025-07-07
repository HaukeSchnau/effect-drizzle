import { sql } from "drizzle-orm";
import { Effect } from "effect";
import { Database, Schema } from "./contract";

const ensurePromise = <T>(value: T | Promise<T>) =>
	value instanceof Promise ? value : Promise.resolve(value);

const migrate = Database.Database.use((db) =>
	db.execute((db) =>
		ensurePromise(
			db.run(
				sql`CREATE TABLE IF NOT EXISTS todos (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, completed INTEGER, created_at INTEGER, updated_at INTEGER);`,
			),
		),
	),
).pipe(Effect.withSpan("migrate"));

const createTodo = Effect.fn("createTodo")(function* (title: string) {
	const db = yield* Database.Database;

	return yield* db.execute((db) =>
		db.insert(Schema.todos).values({
			title,
			completed: 0,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		}),
	);
});

const getTodos = Database.Database.use((db) =>
	db.execute((db) => db.select().from(Schema.todos)),
).pipe(Effect.withSpan("getTodos"));

export const sampleEffect = Effect.gen(function* () {
	yield* migrate;
	yield* createTodo("Do something");
	const todos = yield* getTodos;
	yield* Effect.log(todos);
	return todos;
}).pipe(Effect.withSpan("sampleEffect"));
