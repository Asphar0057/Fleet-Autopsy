// Focus trap logic for the How it works drawer (visual-redesign Requirement 5.2,
// 5.3). Pure, no DOM: the component supplies the focusable count, the current
// index, and a focus callback.

export interface KeyLike {
  key: string;
  shiftKey: boolean;
  preventDefault(): void;
}

/**
 * Tab/Shift+Tab wrap within `count` focusables. Returns the index to focus, or
 * null to let the browser move focus normally.
 */
export function trapIndex(current: number, count: number, shift: boolean): number | null {
  if (count <= 0) return null;
  if (shift) return current <= 0 ? count - 1 : null;
  return current < 0 || current >= count - 1 ? 0 : null;
}

/** Drawer keydown: Escape closes; Tab at an end wraps focus inside the drawer. */
export function drawerKeyDown(
  e: KeyLike,
  current: number,
  count: number,
  onClose: () => void,
  focus: (i: number) => void,
): void {
  if (e.key === 'Escape') {
    e.preventDefault();
    onClose();
    return;
  }
  if (e.key !== 'Tab') return;
  const i = trapIndex(current, count, e.shiftKey);
  if (i === null) return;
  e.preventDefault();
  focus(i);
}
