# effect-drizzle

This project is based on Lucas Barake's [effect-monorepo database](https://github.com/lucas-barake/effect-monorepo/tree/main/packages/database) package.

I've added support for the following databases and made it generic for any Drizzle schema.

- libSQL (Wasm)
- Expo SQLite
- Bun SQLite

## Installation

Since this package is not published to npm, you need to install directly from the repository (for now).

```bash
bun add github:HaukeSchnau/effect-drizzle
```

## Usage (Bun SQLite)

```ts
import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { Redacted, Effect } from "effect";
import * as BunDatabase from "effect-drizzle/bun-sqlite";

const Schema = {
 todos: sqliteTable("todos", {
  id: integer("id").primaryKey(),
  title: text("title").notNull(),
  completed: integer("completed").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
 }),
};

const Database = BunDatabase.factory<typeof Schema>();

const DatabaseLive = Database.layer({
 url: Redacted.make(":memory:"),
 schema: Schema,
});

const program = Effect.gen(function* () {
 const db = yield* Database.Database;

 yield* db.transaction(
  Effect.fnUntraced(function* (tx) {
   yield* tx((client) =>
    client.insert(Schema.todos).values({
     title: "Do something",
     completed: 0,
     createdAt: Date.now(),
     updatedAt: Date.now(),
    }),
   );

   const result = yield* tx((client) =>
    client.select().from(Schema.todos),
   );

   yield* Effect.log(result);
  }),
 );
}).pipe(Effect.provide(DatabaseLive));

BunRuntime.runMain(program);
```
