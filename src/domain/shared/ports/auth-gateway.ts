import type { Result } from "@/domain/shared/result";

export type SignUpError = "email_taken" | "weak_password" | "rate_limited" | "registration_closed" | "unexpected";
export type SignInError = "invalid_credentials" | "email_not_confirmed" | "rate_limited" | "unexpected";

export type Credentials = { email: string; password: string };

export interface AuthGateway {
  signUp(input: Credentials): Promise<Result<{ userId: string; sessionCreated: boolean }, SignUpError>>;
  signIn(input: Credentials): Promise<Result<{ userId: string }, SignInError>>;
  signOut(): Promise<Result<void, "unexpected">>;
  currentUser(): Promise<Result<{ userId: string; email: string } | null, "unexpected">>;
}
