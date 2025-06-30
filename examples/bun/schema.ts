import * as sqlite from "drizzle-orm/sqlite-core";

export const todosTable = sqlite.sqliteTable("todos", {
	id: sqlite.integer("id").primaryKey(),
	title: sqlite.text("title").notNull(),
	completed: sqlite.integer("completed").notNull().default(0),
	createdAt: sqlite.integer("created_at").notNull().default(0),
	updatedAt: sqlite.integer("updated_at").notNull().default(0),
});
