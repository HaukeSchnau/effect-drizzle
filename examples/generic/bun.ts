import { DevTools } from "@effect/experimental";
import { BunRuntime, BunSocket } from "@effect/platform-bun";
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

const DevToolsLive = DevTools.layerWebSocket().pipe(
	Layer.provide(BunSocket.layerWebSocketConstructor),
);

BunRuntime.runMain(
	sampleEffect.pipe(
		Effect.delay("1 second"),
		Effect.forever,
		Effect.provide(DatabaseLive),
		Effect.provide(DevToolsLive),
	),
);
