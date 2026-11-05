/** Errors the API turns into HTTP responses. Anything else becomes an opaque 500. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly issues?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const notFound = (what = "Object") => new ApiError(404, "not_found", `${what} not found`);

interface PgLikeError {
  code?: string;
  message?: string;
  constraint?: string;
}

/** Friendly messages for constraints a user can plausibly hit. */
const CONSTRAINT_MESSAGES: Record<string, string> = {
  edges_single_parent_idx: "An object can have only one parent.",
  edges_live_unique_idx: "This relation already exists.",
};

const isPgError = (e: unknown): e is PgLikeError =>
  typeof e === "object" && e !== null && typeof (e as PgLikeError).code === "string";

/**
 * Translates a database error into an ApiError. The database is the authority on invariants
 * (types, cycles, single parent, decision close rule), so its rejections are surfaced as 4xx.
 * Unknown errors are returned as-is so the caller can log them and answer with a generic 500.
 */
export function mapDbError(e: unknown): unknown {
  if (e instanceof ApiError || !isPgError(e)) return e;
  const friendly = e.constraint ? CONSTRAINT_MESSAGES[e.constraint] : undefined;

  switch (e.code) {
    case "23505":
      return new ApiError(409, "conflict", friendly ?? "That already exists.");
    case "23001":
      return new ApiError(409, "conflict", "Other objects still depend on this one.");
    case "23503":
      return new ApiError(422, "invalid_reference", "A referenced object does not exist.");
    case "23514": {
      // Trigger messages are written for people; raw CHECK messages are not.
      const isCheck = /violates check constraint/.test(e.message ?? "");
      return new ApiError(
        422,
        "constraint_violation",
        isCheck ? "A value is not allowed for this field." : (e.message ?? "Not allowed."),
      );
    }
    case "22P02":
    case "22007":
    case "22008":
    case "22003":
      return new ApiError(400, "invalid_value", "A value has the wrong format.");
    default:
      return e;
  }
}
