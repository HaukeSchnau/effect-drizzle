import * as Effect from "effect/Effect";
import * as DatabaseCore from "../../src/database.libsql-wasm";
import * as DbSchema from "./schema";
import * as Redacted from "effect/Redacted";
import { sql } from "drizzle-orm";

const Database = DatabaseCore.factory<typeof DbSchema>();

const DatabaseLive = Database.layer({
  url: Redacted.make("file:local.db"),
  schema: DbSchema,
});

const program = Effect.gen(function* () {
  const db = yield* Database.Database;

  yield* db.transaction(
    Effect.fnUntraced(function* (tx) {
      yield* tx(
        (client) =>
          client.run(
            sql`CREATE TABLE IF NOT EXISTS todos (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, completed INTEGER, created_at INTEGER, updated_at INTEGER);`
          )
      );

      yield* tx((client) =>
        client.insert(DbSchema.todosTable).values({
          title: "Do something",
          completed: 0,
          createdAt: new Date().getTime(),
          updatedAt: new Date().getTime(),
        })
      );

      const result = yield* tx((client) =>
        client.select().from(DbSchema.todosTable)
      );
      yield* Effect.log(result);

      yield* Effect.log("Done");
    })
  );
}).pipe(Effect.provide(DatabaseLive));

(async () => {
    const result = await Effect.runPromiseExit(program);

    console.log(result);
    document.body.innerHTML = `
        <pre>${JSON.stringify(result, null, 2)}</pre>
    `
})();
