import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import CategoryGrid from "@/components/home/CategoryGrid";

const categories = [
  { name: "Electrician", nameHi: "इलेक्ट्रिशियन", slug: "electrician", icon: "Zap", serviceCount: 5 },
  { name: "Plumber", nameHi: null, slug: "plumber", icon: "Wrench", serviceCount: 4 },
  { name: "Home Tutors", slug: "home-tutors", icon: "GraduationCap" },
];

describe("<CategoryGrid />", () => {
  it("renders each category card with a detail link", () => {
    render(<CategoryGrid categories={categories} />);

    expect(screen.getByText("Electrician")).toBeInTheDocument();
    expect(screen.getByText("Plumber")).toBeInTheDocument();
    expect(screen.getByText("Home Tutors")).toBeInTheDocument();

    const links = screen
      .getAllByRole("link")
      .filter((a) => a.getAttribute("href")?.startsWith("/category/"));
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/category/electrician",
      "/category/plumber",
      "/category/home-tutors",
    ]);
  });

  it("shows service counts when provided", () => {
    render(<CategoryGrid categories={categories} />);
    expect(screen.getByText("5 services")).toBeInTheDocument();
    expect(screen.getByText("4 services")).toBeInTheDocument();
    expect(screen.getByText("Explore services")).toBeInTheDocument();
  });

  it("optionally hides the 'View all' link", () => {
    const { rerender } = render(<CategoryGrid categories={categories} showViewAll />);
    expect(screen.getByRole("link", { name: /view all/i })).toBeInTheDocument();

    rerender(<CategoryGrid categories={categories} showViewAll={false} />);
    expect(screen.queryByRole("link", { name: /view all/i })).not.toBeInTheDocument();
  });
});
