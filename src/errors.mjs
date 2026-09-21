export const ERROR_CATEGORIES = Object.freeze([
  'AUTH',
  'MFA',
  'NETWORK',
  'TIMEOUT',
  'BROWSER_CRASH',
  'BROKER',
  'LEASE',
  'SESSION',
  'TAB_OWNERSHIP',
  'RESOURCE',
  'MCP_TRANSPORT',
  'AGENT_BROWSER',
  'CONFIG',
  'POLICY',
  'UNKNOWN'
]);

export class BrokerError extends Error {
  constructor(category, code, message, details = undefined, httpStatus = 400) {
    super(message);
    this.name = 'BrokerError';
    this.category = ERROR_CATEGORIES.includes(category) ? category : 'UNKNOWN';
    this.code = code;
    this.details = details;
    this.httpStatus = httpStatus;
  }

  toJSON() {
    return {
      error: {
        category: this.category,
        code: this.code,
        message: this.message,
        ...(this.details === undefined ? {} : { details: this.details })
      }
    };
  }
}

export function asBrokerError(error, fallbackCategory = 'UNKNOWN', fallbackCode = 'UNEXPECTED') {
  if (error instanceof BrokerError) return error;
  return new BrokerError(fallbackCategory, fallbackCode, error?.message || String(error), undefined, 500);
}
