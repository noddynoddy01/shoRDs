/** Client-side form checks for sign-in / sign-up (cheap, local; Firebase remains the authority on credentials). */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateSignIn(input: { email: string; password: string }): string | null {
  if (!input.email.trim() || !input.password) return "Enter your email and password.";
  if (!EMAIL_RE.test(input.email.trim())) return "Enter a valid email address.";
  return null;
}

export function validateSignUp(input: { name: string; email: string; password: string }): string | null {
  if (!input.name.trim()) return "Enter your name.";
  if (input.name.trim().length > 100) return "That name is too long.";
  if (!input.email.trim()) return "Enter your email address.";
  if (!EMAIL_RE.test(input.email.trim())) return "Enter a valid email address.";
  if (input.password.length < 6) return "Choose a password of at least 6 characters.";
  if (input.password.length > 1024) return "That password is too long.";
  return null;
}
