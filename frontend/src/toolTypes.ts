export type ToolId =
  | 'select' | 'pan' | 'pen' | 'highlighter' | 'eraser'
  | 'line' | 'arrow' | 'circle' | 'compass' | 'rect'
  | 'point' | 'text' | 'angle' | 'trace' | 'laser'
  | `c:${string}`;

export interface ToolOpts {
  color: string;
  width: number;
  dash: 'solid' | 'dashed' | 'dotted';
  fill: boolean;
  snap: boolean;
  lockAspect: boolean;
  compassRadius: string;
  sides: number;
  angleDeg: number;
  sss: [number, number, number];
  /** Eraser radius in screen pixels. */
  eraserSize: number;
  /** false = rub out only the part under the eraser; true = remove the whole drawing it touches. */
  eraseWhole: boolean;
}

export const defaultOpts: ToolOpts = {
  color: 'auto', width: 2, dash: 'solid', fill: false, snap: true, lockAspect: true,
  compassRadius: '', sides: 5, angleDeg: 60, sss: [3, 4, 5], eraserSize: 14, eraseWhole: false,
};

export const COLORS = ['auto', '#d64550', '#2f6fdb', '#1f9d6b', '#e08a00', '#8a4fd6', '#0e9aa7', '#c2185b', '#5d4037', '#7a869a'];

export interface ToolInfo { id: ToolId; label: string; icon: string; hint: string; group: 'nav' | 'draw' | 'shape' | 'mark' }

export const TOOLS: ToolInfo[] = [
  { id: 'select', label: 'Select', icon: '⬚', hint: 'Click to select, drag to move. Delete removes. Alt+drag ignores instruments.', group: 'nav' },
  { id: 'pan', label: 'Pan', icon: '✋', hint: 'Drag to move the paper. Mouse wheel or pinch to zoom.', group: 'nav' },
  { id: 'pen', label: 'Pencil', icon: '✎', hint: 'Draw freehand. Start on a ruler or set-square edge to draw a straight line along it.', group: 'draw' },
  { id: 'highlighter', label: 'Highlighter', icon: '🖍', hint: 'Highlight in translucent colour.', group: 'draw' },
  { id: 'eraser', label: 'Eraser', icon: '⌫', hint: 'Drag to rub out the part of a drawing under the circle. Change the size above, or switch to “Whole stroke”.', group: 'draw' },
  { id: 'line', label: 'Line (ruler)', icon: '╱', hint: 'Drag to draw a straight line. Start on an instrument edge to follow it. Shift = 15° steps.', group: 'shape' },
  { id: 'arrow', label: 'Arrow', icon: '➚', hint: 'Drag to draw an arrow.', group: 'shape' },
  { id: 'circle', label: 'Circle', icon: '◯', hint: 'Drag from the centre out to the radius.', group: 'shape' },
  { id: 'compass', label: 'Compass', icon: '⌓', hint: 'Click the centre, then press and drag around it to sweep an arc. Set a radius to fix it.', group: 'shape' },
  { id: 'rect', label: 'Rectangle', icon: '▭', hint: 'Drag from corner to corner.', group: 'shape' },
  { id: 'point', label: 'Point', icon: '•', hint: 'Click to mark a labelled point (A, B, C…).', group: 'mark' },
  { id: 'text', label: 'Text', icon: 'T', hint: 'Click where the text should go.', group: 'mark' },
  { id: 'angle', label: 'Measure angle', icon: '∠', hint: 'Click a point on one arm, the vertex, then a point on the other arm.', group: 'mark' },
  { id: 'trace', label: 'Trace', icon: '⌖', hint: 'Move over a curve to read its coordinates.', group: 'mark' },
  { id: 'laser', label: 'Laser pointer', icon: '◉', hint: 'Show a red pointer that fades — nothing is drawn.', group: 'mark' },
];
