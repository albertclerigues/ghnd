export interface FocusState {
  /** Index of the focused notification block (-1 = none) */
  notificationIndex: number;
  /** Index of the focused event within the notification (-1 = notification level) */
  eventIndex: number;
  /** Whether focus is inside the event subtree */
  inSubItems: boolean;
}

export type FocusChangeCallback = (state: FocusState) => void;

export class FocusManager {
  private notificationIndex = -1;
  private eventIndex = -1;
  private inSubItems = false;
  private notificationCount = 0;
  private eventCounts: number[] = [];
  private onChange: FocusChangeCallback | undefined;

  setOnChange(callback: FocusChangeCallback): void {
    this.onChange = callback;
  }

  /** Call after rendering to update the navigable item counts */
  updateCounts(notificationCount: number, eventCounts: number[]): void {
    this.notificationCount = notificationCount;
    this.eventCounts = eventCounts;

    // Clamp focus if list shrank
    if (this.notificationIndex >= notificationCount) {
      this.notificationIndex = Math.max(0, notificationCount - 1);
      this.inSubItems = false;
      this.eventIndex = -1;
    }
  }

  getState(): FocusState {
    return {
      notificationIndex: this.notificationIndex,
      eventIndex: this.eventIndex,
      inSubItems: this.inSubItems,
    };
  }

  /** Move focus up (previous notification or previous event) */
  moveUp(): void {
    if (this.inSubItems) {
      if (this.eventIndex > 0) {
        this.eventIndex--;
      } else {
        // At first event, exit back to notification header
        this.inSubItems = false;
        this.eventIndex = -1;
      }
    } else {
      if (this.notificationIndex > 0) {
        this.notificationIndex--;
      }
    }
    this.emitChange();
  }

  /** Move focus down (next notification or next event) */
  moveDown(): void {
    if (this.notificationIndex === -1) {
      // Nothing focused yet, focus the first item
      if (this.notificationCount > 0) {
        this.notificationIndex = 0;
      }
    } else if (this.inSubItems) {
      const maxEvent = (this.eventCounts[this.notificationIndex] ?? 1) - 1;
      if (this.eventIndex < maxEvent) {
        this.eventIndex++;
      }
      // At last event, stay (don't auto-exit)
    } else {
      if (this.notificationIndex < this.notificationCount - 1) {
        this.notificationIndex++;
      }
    }
    this.emitChange();
  }

  /** Enter sub-items of the current notification */
  moveRight(): void {
    if (this.notificationIndex === -1) return;
    const eventCount = this.eventCounts[this.notificationIndex] ?? 0;
    if (!this.inSubItems && eventCount > 0) {
      this.inSubItems = true;
      this.eventIndex = 0;
    }
    this.emitChange();
  }

  /** Exit sub-items back to notification level */
  moveLeft(): void {
    if (this.inSubItems) {
      this.inSubItems = false;
      this.eventIndex = -1;
    }
    this.emitChange();
  }

  /** Reset focus (e.g., after list re-render from new data) */
  reset(): void {
    // Keep notificationIndex if valid, reset sub-focus
    if (this.notificationIndex >= this.notificationCount) {
      this.notificationIndex = this.notificationCount > 0 ? 0 : -1;
    }
    this.inSubItems = false;
    this.eventIndex = -1;
    this.emitChange();
  }

  private emitChange(): void {
    this.onChange?.(this.getState());
  }
}
