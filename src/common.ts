import { Data } from "effect";

export class DatabaseConnectionLostError extends Data.TaggedError(
	"DatabaseConnectionLostError",
)<{
	cause: unknown;
	message: string;
}> {}

export class DatabaseError<
	BaseError extends { message: string },
> extends Data.TaggedError("DatabaseError")<{
	readonly type:
		| "unique_violation"
		| "foreign_key_violation"
		| "connection_error";
	readonly cause: BaseError;
}> {
	public override toString() {
		return `DatabaseError: ${this.cause.message}`;
	}

	public override get message() {
		return this.cause.message;
	}
}
