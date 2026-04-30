export class RetrievalError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "RetrievalError";
  }
}

export class ObsidianCliError extends RetrievalError {
  constructor(message: string, code = "OBSIDIAN_CLI_ERROR") {
    super(message, code);
    this.name = "ObsidianCliError";
  }
}

export class BudgetExceededError extends RetrievalError {
  constructor(message = "Retrieval output exceeded the configured budget") {
    super(message, "BUDGET_EXCEEDED");
    this.name = "BudgetExceededError";
  }
}

export class PathSafetyError extends RetrievalError {
  constructor(message: string, code = "UNSAFE_PATH") {
    super(message, code);
    this.name = "PathSafetyError";
  }
}
