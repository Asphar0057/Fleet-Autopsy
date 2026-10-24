// Ground-truth marker types shared by the renderer and the UI. No DOM, so
// pure UI helpers (and their tests) can use them without the canvas renderer.

/**
 * One ground-truth marker. `index` is a robot id (drawn at the robot's cell at
 * the displayed tick), a cell index, or a station index, depending on `target`.
 * `tag` is the mono label drawn next to the square, for example `F1`.
 */
export interface RevealMark {
  target: 'robot' | 'cell' | 'station';
  index: number;
  tag: string;
}

export type RevealMarks = readonly RevealMark[];
