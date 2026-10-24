// Jam badge text (Requirement 9.2). Pure, no DOM.
import type { Jam } from '../sim/jam';
import type { Badge } from './badge';
import { pad4 } from './playback';

/**
 * `HEALTHY` in ink, or `JAM DETECTED · ONSET T=<onset> · SEVERITY <n>%` in the
 * accent color. The onset tick is zero-padded to 4 digits like the header tick.
 */
export function jamBadgeText(jam: Jam | null): Badge {
  if (jam === null) return { text: 'HEALTHY', alert: false };
  return {
    text: `JAM DETECTED · ONSET T=${pad4(jam.onsetTick)} · SEVERITY ${Math.round(jam.severity * 100)}%`,
    alert: true,
  };
}
