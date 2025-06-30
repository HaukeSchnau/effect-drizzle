import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { genericDatabaseFactory } from "../../src/generic-sqlite";

export const Schema = {
	todos: sqliteTable("todos", {
		id: integer("id").primaryKey(),
		title: text("title").notNull(),
		completed: integer("completed").notNull(),
		createdAt: integer("created_at").notNull(),
		updatedAt: integer("updated_at").notNull(),
	}),
};

export const Database = genericDatabaseFactory<typeof Schema>();
