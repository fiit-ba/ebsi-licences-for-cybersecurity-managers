/** Administrative refusal with a stable HTTP status and public reason. */
export class OperatorManagementError extends Error {
  readonly status: number;
  readonly body: { reason: string; detail: string };

  /**
   * Create an account-management refusal.
   * @param status - HTTP response status.
   * @param reason - Stable refusal code.
   * @param detail - Public explanation without secrets.
   */
  constructor(status: number, reason: string, detail: string) {
    super(detail);
    this.status = status;
    this.body = { reason, detail };
  }
}
