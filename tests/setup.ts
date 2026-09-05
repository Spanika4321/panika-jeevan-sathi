import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Belt-and-braces cleanup so a leaking render can never bleed into the next test.
afterEach(() => {
  cleanup();
});
