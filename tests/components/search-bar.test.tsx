import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SearchBar from "@/components/search/SearchBar";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push }),
}));

beforeEach(() => {
  push.mockClear();
});

describe("<SearchBar />", () => {
  it("renders service, location and PIN inputs", () => {
    render(<SearchBar />);
    expect(screen.getByPlaceholderText(/what do you need/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/city or locality/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("PIN code")).toBeInTheDocument();
  });

  it("navigates with the built query when all fields are filled", async () => {
    const user = userEvent.setup();
    render(<SearchBar />);

    await user.type(screen.getByPlaceholderText(/what do you need/i), "electrician");
    await user.type(screen.getByPlaceholderText(/city or locality/i), "Karol Bagh");
    await user.type(screen.getByPlaceholderText("PIN code"), "110005");
    await user.click(screen.getByRole("button", { name: /search/i }));

    expect(push).toHaveBeenCalledWith("/search?service=electrician&location=Karol+Bagh&pin=110005");
  });

  it("navigates to bare /search when nothing is entered", async () => {
    const user = userEvent.setup();
    render(<SearchBar />);

    await user.click(screen.getByRole("button", { name: /search/i }));
    expect(push).toHaveBeenCalledWith("/search");
  });

  it("only allows digits in the PIN field", async () => {
    const user = userEvent.setup();
    render(<SearchBar />);

    const pin = screen.getByPlaceholderText("PIN code") as HTMLInputElement;
    await user.type(pin, "11a0b0c0d0");
    expect(pin.value).toBe("110000"); // letters stripped, capped at 6 digits
  });

  it("quick-search chips navigate to pre-filtered results", async () => {
    const user = userEvent.setup();
    render(<SearchBar />);

    await user.click(screen.getByRole("button", { name: "Plumber" }));
    expect(push).toHaveBeenCalledWith("/search?service=Plumber");
  });
});
