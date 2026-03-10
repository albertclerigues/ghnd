import { describe, expect, test } from "bun:test";
import { FocusManager } from "../../src/mainview/focus.js";

describe("FocusManager", () => {
  test("initial state has no focus", () => {
    const fm = new FocusManager();
    fm.updateCounts(3, [2, 1, 3]);
    const state = fm.getState();
    expect(state.notificationIndex).toBe(-1);
    expect(state.eventIndex).toBe(-1);
    expect(state.inSubItems).toBe(false);
  });

  test("moveDown from no focus selects first notification", () => {
    const fm = new FocusManager();
    fm.updateCounts(3, [2, 1, 3]);
    fm.moveDown();
    expect(fm.getState().notificationIndex).toBe(0);
  });

  test("moveDown advances through notifications", () => {
    const fm = new FocusManager();
    fm.updateCounts(3, [2, 1, 3]);
    fm.moveDown(); // 0
    fm.moveDown(); // 1
    fm.moveDown(); // 2
    expect(fm.getState().notificationIndex).toBe(2);
  });

  test("moveDown does not go past last notification", () => {
    const fm = new FocusManager();
    fm.updateCounts(2, [1, 1]);
    fm.moveDown(); // 0
    fm.moveDown(); // 1
    fm.moveDown(); // still 1
    expect(fm.getState().notificationIndex).toBe(1);
  });

  test("moveUp goes back through notifications", () => {
    const fm = new FocusManager();
    fm.updateCounts(3, [2, 1, 3]);
    fm.moveDown(); // 0
    fm.moveDown(); // 1
    fm.moveUp(); // 0
    expect(fm.getState().notificationIndex).toBe(0);
  });

  test("moveUp at first notification stays at 0", () => {
    const fm = new FocusManager();
    fm.updateCounts(3, [2, 1, 3]);
    fm.moveDown(); // 0
    fm.moveUp(); // still 0
    expect(fm.getState().notificationIndex).toBe(0);
  });

  test("moveRight enters sub-items", () => {
    const fm = new FocusManager();
    fm.updateCounts(2, [3, 1]);
    fm.moveDown(); // notification 0
    fm.moveRight(); // enter sub-items, event 0
    const state = fm.getState();
    expect(state.inSubItems).toBe(true);
    expect(state.eventIndex).toBe(0);
  });

  test("moveRight does nothing if no events", () => {
    const fm = new FocusManager();
    fm.updateCounts(2, [0, 1]);
    fm.moveDown(); // notification 0 (0 events)
    fm.moveRight();
    expect(fm.getState().inSubItems).toBe(false);
  });

  test("moveDown in sub-items advances through events", () => {
    const fm = new FocusManager();
    fm.updateCounts(2, [3, 1]);
    fm.moveDown(); // notification 0
    fm.moveRight(); // event 0
    fm.moveDown(); // event 1
    fm.moveDown(); // event 2
    expect(fm.getState().eventIndex).toBe(2);
  });

  test("moveDown at last event stays", () => {
    const fm = new FocusManager();
    fm.updateCounts(2, [2, 1]);
    fm.moveDown(); // notification 0
    fm.moveRight(); // event 0
    fm.moveDown(); // event 1
    fm.moveDown(); // still event 1
    expect(fm.getState().eventIndex).toBe(1);
  });

  test("moveUp in sub-items goes back to notification header", () => {
    const fm = new FocusManager();
    fm.updateCounts(2, [2, 1]);
    fm.moveDown(); // notification 0
    fm.moveRight(); // event 0
    fm.moveUp(); // back to notification header
    const state = fm.getState();
    expect(state.inSubItems).toBe(false);
    expect(state.eventIndex).toBe(-1);
    expect(state.notificationIndex).toBe(0);
  });

  test("moveLeft exits sub-items", () => {
    const fm = new FocusManager();
    fm.updateCounts(2, [2, 1]);
    fm.moveDown(); // notification 0
    fm.moveRight(); // event 0
    fm.moveDown(); // event 1
    fm.moveLeft(); // back to notification level
    const state = fm.getState();
    expect(state.inSubItems).toBe(false);
    expect(state.eventIndex).toBe(-1);
    expect(state.notificationIndex).toBe(0);
  });

  test("onChange callback fires on navigation", () => {
    const fm = new FocusManager();
    const states: Array<{ notificationIndex: number }> = [];
    fm.setOnChange((s) => states.push({ notificationIndex: s.notificationIndex }));
    fm.updateCounts(3, [1, 1, 1]);
    fm.moveDown();
    fm.moveDown();
    expect(states).toHaveLength(2);
    expect(states[1]?.notificationIndex).toBe(1);
  });

  test("updateCounts clamps focus when list shrinks", () => {
    const fm = new FocusManager();
    fm.updateCounts(5, [1, 1, 1, 1, 1]);
    fm.moveDown(); // 0
    fm.moveDown(); // 1
    fm.moveDown(); // 2
    fm.moveDown(); // 3
    fm.updateCounts(2, [1, 1]);
    expect(fm.getState().notificationIndex).toBe(1);
  });
});
