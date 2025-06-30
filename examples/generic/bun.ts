import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import { Effect, Layer, Redacted } from "effect";
import { makeService } from "../../src/database.bun-sqlite";
import { Database, Schema } from "./contract";
import { sampleEffect } from "./sample-effect";

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

BunRuntime.runMain(sampleEffect.pipe(Effect.provide(DatabaseLive)));
