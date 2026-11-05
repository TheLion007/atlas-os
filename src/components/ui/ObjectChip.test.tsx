// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../tests/support/a11y";
import { ObjectChip, type ChipObject } from "./ObjectChip";

const project: ChipObject = { id: "p1", type: "project", title: "Dorsel Marina Apartment" };

describe("ObjectChip", () => {
  it("names the object and its type for assistive technology", () => {
    render(<ObjectChip object={project} onPeek={() => {}} />);
    expect(screen.getByRole("button", { name: /Dorsel Marina Apartment, Project/ })).toBeTruthy();
  });

  it("peeks on click and on Space, without opening", async () => {
    const user = userEvent.setup();
    const onPeek = vi.fn();
    render(<ObjectChip object={project} href="/objects/p1" onPeek={onPeek} />);
    const chip = screen.getByRole("link");

    await user.click(chip);
    expect(onPeek).toHaveBeenCalledWith("p1");

    onPeek.mockClear();
    chip.focus();
    await user.keyboard(" ");
    expect(onPeek).toHaveBeenCalledTimes(1);
    expect(onPeek).toHaveBeenCalledWith("p1");
  });

  it("opens on Enter: it stays a real link to the object's own page", () => {
    render(<ObjectChip object={project} href="/objects/p1" onPeek={() => {}} />);
    expect(screen.getByRole("link").getAttribute("href")).toBe("/objects/p1");
  });

  it("lets modified clicks through so 'open in new tab' still works", async () => {
    const user = userEvent.setup();
    const onPeek = vi.fn();
    render(<ObjectChip object={project} href="/objects/p1" onPeek={onPeek} />);
    await user.keyboard("{Control>}");
    await user.click(screen.getByRole("link"));
    await user.keyboard("{/Control}");
    expect(onPeek).not.toHaveBeenCalled();
  });

  it("marks the selected state", () => {
    render(<ObjectChip object={project} onPeek={() => {}} selected />);
    const chip = screen.getByRole("button");
    expect(chip.getAttribute("data-state")).toBe("selected");
    expect(chip.getAttribute("aria-pressed")).toBe("true");
  });

  it("says when an object is stale, not by colour alone", () => {
    render(<ObjectChip object={project} onPeek={() => {}} stale />);
    expect(screen.getByRole("button").textContent).toContain("stale");
    expect(screen.getByRole("button").getAttribute("data-state")).toBe("stale");
  });

  it("renders a broken reference as non-interactive text", () => {
    const { container } = render(<ObjectChip object={null} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(container.textContent).toContain("Missing object");
    expect(container.firstElementChild?.getAttribute("data-state")).toBe("broken-ref");
  });

  it("shows trailing meta such as a date", () => {
    render(<ObjectChip object={project} onPeek={() => {}} meta="30 Jun 2031" />);
    expect(screen.getByRole("button").textContent).toContain("30 Jun 2031");
  });

  it("has no accessibility violations in any state", async () => {
    const { container } = render(
      <div>
        <ObjectChip object={project} onPeek={() => {}} />
        <ObjectChip object={project} href="/objects/p1" onPeek={() => {}} selected />
        <ObjectChip object={project} onPeek={() => {}} stale />
        <ObjectChip object={null} />
      </div>,
    );
    expect(await axeViolations(container)).toEqual([]);
  });
});
