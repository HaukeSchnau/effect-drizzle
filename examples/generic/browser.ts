import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { Effect, Layer, Redacted } from "effect";
import { makeService } from "effect-drizzle/libsql-wasm";
import { Database } from "./contract";
import { sampleEffect } from "./sample-effect";

const Schema = {
	todos: sqliteTable("todos", {
		id: integer("id").primaryKey(),
		title: text("title").notNull(),
		completed: integer("completed").notNull(),
		createdAt: integer("created_at").notNull(),
		updatedAt: integer("updated_at").notNull(),
	}),
};

const DatabaseLive = Layer.scoped(
	Database.Database,
	makeService(
		{
			url: Redacted.make(":memory:"),
			schema: Schema,
		},
		Database.TransactionContext,
	),
);

const program = sampleEffect.pipe(Effect.provide(DatabaseLive));

(async () => {
	const result = await Effect.runPromiseExit(program);

	document.body.innerHTML = `
        <pre>${JSON.stringify(result, null, 2)}</pre>
    `;
})();
