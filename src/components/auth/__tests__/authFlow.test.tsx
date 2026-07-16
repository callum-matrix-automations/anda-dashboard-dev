import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_TWO_FACTOR_CODE } from "@/domain/auth";
import { SignInScreen } from "../SignInScreen";
import { ForgotPasswordScreen } from "../ForgotPasswordScreen";
import { TwoFactorScreen } from "../TwoFactorScreen";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

beforeEach(() => push.mockClear());

describe("SignInScreen", () => {
  it("rejects a malformed email without navigating", async () => {
    render(<SignInScreen />);
    await userEvent.type(screen.getByLabelText("Email"), "not-an-email");
    await userEvent.type(screen.getByLabelText("Password"), "meeting-records");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Enter a valid email address.")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("rejects a short password without navigating", async () => {
    render(<SignInScreen />);
    await userEvent.type(screen.getByLabelText("Email"), "grace@anda.local");
    await userEvent.type(screen.getByLabelText("Password"), "short");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Password must be at least 8 characters.")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("reveals and hides the password", async () => {
    render(<SignInScreen />);
    const password = screen.getByLabelText("Password");
    expect(password).toHaveAttribute("type", "password");
    await userEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(password).toHaveAttribute("type", "text");
    await userEvent.click(screen.getByRole("button", { name: "Hide password" }));
    expect(password).toHaveAttribute("type", "password");
  });

  it("continues to two-factor verification on valid credentials", async () => {
    render(<SignInScreen />);
    await userEvent.type(screen.getByLabelText("Email"), "grace@anda.local");
    await userEvent.type(screen.getByLabelText("Password"), "meeting-records");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(push).toHaveBeenCalledWith("/auth/verify");
  });

  it("continues to two-factor verification through mock SSO", async () => {
    render(<SignInScreen />);
    await userEvent.click(screen.getByRole("button", { name: "Continue with Microsoft" }));
    expect(push).toHaveBeenCalledWith("/auth/verify");
    push.mockClear();
    await userEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(push).toHaveBeenCalledWith("/auth/verify");
  });

  it("links to password recovery", () => {
    render(<SignInScreen />);
    expect(screen.getByRole("link", { name: "Forgot password?" })).toHaveAttribute("href", "/auth/forgot-password");
  });
});

describe("ForgotPasswordScreen", () => {
  it("rejects a malformed email", async () => {
    render(<ForgotPasswordScreen />);
    await userEvent.type(screen.getByLabelText("Email"), "nope");
    await userEvent.click(screen.getByRole("button", { name: "Send reset instructions" }));
    expect(await screen.findByText("Enter a valid email address.")).toBeInTheDocument();
  });

  it("confirms success and states that this is a demo with no real email", async () => {
    render(<ForgotPasswordScreen />);
    await userEvent.type(screen.getByLabelText("Email"), "grace@anda.local");
    await userEvent.click(screen.getByRole("button", { name: "Send reset instructions" }));
    expect(await screen.findByRole("status")).toHaveTextContent(/demo/i);
    expect(screen.getByRole("link", { name: "Back to sign in" })).toHaveAttribute("href", "/auth/sign-in");
  });
});

describe("TwoFactorScreen", () => {
  async function typeCode(code: string) {
    for (const [index, digit] of [...code].entries()) {
      await userEvent.type(screen.getByLabelText(`Digit ${index + 1}`), digit);
    }
  }

  it("documents the deterministic demo code on screen", () => {
    render(<TwoFactorScreen />);
    expect(screen.getByText(DEMO_TWO_FACTOR_CODE)).toBeInTheDocument();
  });

  it("rejects an incomplete code", async () => {
    render(<TwoFactorScreen />);
    await userEvent.click(screen.getByRole("button", { name: "Verify code" }));
    expect(await screen.findByText("Enter all 6 digits.")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("rejects a wrong code with guidance", async () => {
    render(<TwoFactorScreen />);
    await typeCode("000000");
    await userEvent.click(screen.getByRole("button", { name: "Verify code" }));
    expect(await screen.findByText(/does not match/)).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("lands on the dashboard with the demo code", async () => {
    render(<TwoFactorScreen />);
    await typeCode(DEMO_TWO_FACTOR_CODE);
    await userEvent.click(screen.getByRole("button", { name: "Verify code" }));
    expect(push).toHaveBeenCalledWith("/app/dashboard");
  });

  it("confirms a deterministic resend without leaving the page", async () => {
    render(<TwoFactorScreen />);
    await userEvent.click(screen.getByRole("button", { name: "Resend code" }));
    expect(await screen.findByRole("status")).toHaveTextContent(/demo/i);
    expect(push).not.toHaveBeenCalled();
  });

  it("offers a way back to sign in", () => {
    render(<TwoFactorScreen />);
    expect(screen.getByRole("link", { name: "Back to sign in" })).toHaveAttribute("href", "/auth/sign-in");
  });
});
