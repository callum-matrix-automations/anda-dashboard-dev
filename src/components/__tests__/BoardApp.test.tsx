import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BoardApp } from "../BoardApp";
import { WorkspaceProvider } from "../providers/WorkspaceProvider";

let pathname = "/app/dashboard";
vi.mock("next/navigation",()=>({usePathname:()=>pathname}));
vi.mock("next/link",()=>({default:({href,children,...props}:React.AnchorHTMLAttributes<HTMLAnchorElement>&{href:string})=><a href={href} {...props}>{children}</a>}));
const renderApp=()=>render(<WorkspaceProvider><BoardApp/></WorkspaceProvider>);
describe("BoardApp routes",()=>{beforeEach(()=>{pathname="/app/dashboard";localStorage.clear()});
  it("renders the compact dashboard and live navigation task counts",async()=>{renderApp();expect(await screen.findByText("Good morning, Priya")).toBeInTheDocument();expect(screen.getByRole("link",{name:/Needs review/})).toHaveAttribute("href","/app/needs-review");expect(await screen.findByLabelText("5 needs review tasks")).toBeInTheDocument();expect(screen.getByLabelText("3 signing tasks")).toBeInTheDocument();expect(screen.getByText("Meeting pipeline")).toBeInTheDocument()});
  it("offers only Officer, Treasurer, Account Admin, and Superadmin simulator choices",async()=>{
    renderApp();
    const level=screen.getByLabelText("ANDA workspace role");
    await screen.findByRole("link",{name:/Signing/});
    expect(screen.queryByRole("link",{name:"Accounts"})).not.toBeInTheDocument();

    expect(screen.queryByRole("option",{name:"user"})).not.toBeInTheDocument();

    await userEvent.selectOptions(level,"a");
    expect(screen.getByRole("link",{name:"Accounts"})).toBeInTheDocument();
    expect(screen.getByRole("link",{name:/Needs review/})).toBeInTheDocument();
    expect(screen.queryByRole("link",{name:/Signing/})).not.toBeInTheDocument();

    await userEvent.selectOptions(level,"s");
    expect(screen.getByRole("link",{name:"Accounts"})).toBeInTheDocument();
    expect(screen.queryByRole("link",{name:"All meetings"})).not.toBeInTheDocument();
    expect(screen.queryByRole("link",{name:"Archive"})).not.toBeInTheDocument();
    expect(screen.getByText("Superadmin is internal-only and has no meeting access.")).toBeInTheDocument();
  });
  it("uses the ANDA Dashboard product name instead of legacy workspace labels",async()=>{renderApp();await screen.findByText("Good morning, Priya");expect(screen.getByText("ANDA Dashboard")).toBeInTheDocument();expect(screen.getByText("Meeting records")).toBeInTheDocument();expect(screen.queryByText("Governance workspace")).not.toBeInTheDocument()});
  it("renders a queue route",async()=>{pathname="/app/signing";renderApp();expect(await screen.findByRole("heading",{name:"Signing"})).toBeInTheDocument();expect(screen.getAllByText("May Board Meeting").length).toBeGreaterThanOrEqual(1)});
  it("renders a failure route with honest local-only feedback",async()=>{pathname="/app/failures/pdf";renderApp();expect(screen.getByRole("heading",{name:"PDF generation failed"})).toBeInTheDocument();await userEvent.click(screen.getByRole("button",{name:"Retry"}));expect(screen.getByRole("status")).toHaveTextContent(/No PDF service was called/i);await userEvent.click(screen.getByRole("button",{name:"Report Issue"}));expect(screen.getByRole("status")).toHaveTextContent(/No report was sent/i)});
  it("rejects arbitrary trailing route segments",()=>{pathname="/app/settings/not-real";renderApp();expect(screen.getByRole("heading",{name:"Page not found"})).toBeInTheDocument();expect(screen.getByText("That ANDA Dashboard route does not exist.")).toBeInTheDocument()});
  it("persists a theme choice from Settings",async()=>{pathname="/app/settings";renderApp();await userEvent.click(await screen.findByRole("radio",{name:"Dark"}));await waitFor(()=>expect(localStorage.getItem("board-theme")).toBe("board-dark"))});
});
