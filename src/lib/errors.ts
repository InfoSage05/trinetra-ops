export class DomainError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "DomainError";
    this.code = code;
  }
}

export class ValidationError extends DomainError {
  readonly fieldErrors: Record<string, string[]>;
  constructor(message: string, fieldErrors: Record<string, string[]> = {}) {
    super("VALIDATION", message);
    this.name = "ValidationError";
    this.fieldErrors = fieldErrors;
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = "You do not have permission to do this.") {
    super("FORBIDDEN", message);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends DomainError {
  constructor(what: string) {
    super("NOT_FOUND", `${what} was not found.`);
    this.name = "NotFoundError";
  }
}
