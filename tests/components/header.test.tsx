import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Header from "@/components/layout/Header";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn() }),
}));

describe("<Header />", () => {
  it("renders the brand and primary nav links", () => {
    render(<Header />);
    expect(screen.getByRole("link", { name: /seva\s*market/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Home" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Categories" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "How it works" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "For Providers" })).toBeInTheDocument();
  });

  it("shows the desktop provider CTA linking to /provider/join", () => {
    render(<Header />);
    const ctas = screen
      .getAllByRole("link", { name: /become a provider/i })
      .filter((el) => el.getAttribute("href") === "/provider/join");
    expect(ctas.length).toBeGreaterThan(0);
  });

  it("toggles the mobile menu via the hamburger button", async () => {
    const user = userEvent.setup();
    render(<Header />);

    const toggle = screen.getByRole("button", { name: /open menu/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("navigation", { name: "Mobile" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /close menu/i }));
    expect(screen.queryByRole("navigation", { name: "Mobile" })).not.toBeInTheDocument();
  });
});
