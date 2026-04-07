function extractErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  if (typeof error === 'object' && error && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return '';
}

export function normalizeAuthError(error: unknown, fallback = 'E-UNKNOWN: Something went wrong.'): string {
  const message = extractErrorMessage(error).trim();
  const lower = message.toLowerCase();

  if (!message) return fallback;

  if (message.startsWith('E-')) return message;

  if (
    lower.includes('timed out') ||
    lower.includes('not allowed') ||
    lower.includes('authentication cancelled') ||
    lower.includes('registration cancelled') ||
    lower.includes('operation was aborted') ||
    lower.includes('the user attempted to use') ||
    lower.includes('privacy-considerations-client')
  ) {
    return 'E-BIO-CANCELLED: Biometric prompt was cancelled.';
  }

  if (lower.includes('choose a passkey')) {
    return 'E-BIO-EXTERNAL: Windows Hello requested an external passkey.';
  }

  if (lower.includes('already registered')) {
    return 'E-BIO-REGISTERED: A biometric passkey is already registered.';
  }

  if (lower.includes('no passkey registered')) {
    return 'E-BIO-NO-PASSKEY: No biometric passkey is registered.';
  }

  if (lower.includes('invalid password') || lower.includes('invalid current password')) {
    return 'E-AUTH-PASSWORD: Current password is incorrect.';
  }

  if (lower.includes('password must be at least')) {
    return 'E-AUTH-PASSWORD-SHORT: Password must be at least 4 characters.';
  }

  if (lower.includes('passwords do not match')) {
    return 'E-AUTH-PASSWORD-MISMATCH: Passwords do not match.';
  }

  if (lower.includes('enter your password')) {
    return 'E-AUTH-PASSWORD-REQUIRED: Enter your password.';
  }

  return fallback === 'E-UNKNOWN: Something went wrong.' ? `E-UNKNOWN: ${message}` : fallback;
}
