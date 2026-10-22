import { ChangePasswordForm } from "@/components/change-password-form";

export default function ChangePasswordPage() {
  return (
    <div className="mx-auto max-w-sm space-y-4">
      <h1>Change your password</h1>
      <p className="text-sm text-muted-foreground">Use at least 8 characters. Do not share it with anyone.</p>
      <ChangePasswordForm />
    </div>
  );
}
