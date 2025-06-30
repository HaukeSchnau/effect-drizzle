import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as Effect from "effect/Effect";
import * as BunDatabase from "../../src/database.bun-sqlite";
import { Redacted } from "effect";
import { sql } from "drizzle-orm";
import * as DbSchema from "./schema";

const Database = BunDatabase.factory<typeof DbSchema>();

const program = Effect.gen(function* () {
  const db = yield* Database.Database;

  yield* db.transaction(
    Effect.fnUntraced(function* (tx) {
      yield* tx((client) =>
        new Promise((resolve) => {
          client.run(sql`CREATE TABLE IF NOT EXISTS todos (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, completed INTEGER, created_at INTEGER, updated_at INTEGER);`);
          resolve(void 0);
        })
      );

      yield* tx((client) =>
        client.insert(DbSchema.todosTable).values({
          title: "Do something",
          completed: 0,
          createdAt: new Date().getTime(),
          updatedAt: new Date().getTime(),
        }),
      );

      const result = yield* tx((client) =>
        client.select().from(DbSchema.todosTable),
      );
      yield* Effect.log(result);

      yield* Effect.log("Done");
    }),
  );
}).pipe(
  Effect.provide(
    Database.layer({
      url: Redacted.make(":memory:"),
      schema: DbSchema,
    }),
  ),
);

BunRuntime.runMain(program);
