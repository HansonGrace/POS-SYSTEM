export class TransactionError extends Error {
  constructor(code, message, statusCode = 400, details = null) {
    super(message);
    this.name = "TransactionError";
    this.code = code;
    this.statusCode = statusCode;
    if (details !== null && details !== undefined) {
      this.details = details;
    }
  }
}
