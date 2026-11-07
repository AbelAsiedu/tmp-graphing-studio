export type TourTab = 'graph' | 'draw' | 'chart' | 'paper' | 'pages' | 'export';

export interface TourCtx { signedIn: boolean; role: string | null }

export interface TourStep {
  id: string;
  /** CSS selector of the thing to highlight; omit for a centred card. */
  target?: string;
  /** Side-panel tab to open for this step (null/undefined = close the panel on phones). */
  tab?: TourTab;
  title: string;
  body: string | ((c: TourCtx) => string);
  /** Optional "try it" button. */
  action?: { id: 'plot-example'; label: string; done: string };
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to the Graphing Studio',
    body: 'A maths drawing board with real instruments, graph paper, equations and charts. This one-minute tour shows where everything is. Nothing here can break anything — Undo is always one tap away.',
  },
  {
    id: 'tools',
    target: '[data-tour="tools"]',
    title: 'Pick a tool',
    body: 'Draw freehand, make lines, arrows, circles and rectangles, add points and text, measure angles — or use the Eraser to rub out just part of a drawing. Choose a tool, then drag on the paper.',
  },
  {
    id: 'paper',
    target: '[data-tour="stage"]',
    title: 'This is your paper',
    body: 'Pinch or scroll to zoom. Move around with the ✋ Pan tool (on a computer you can also hold Space and drag). The ⌂ button brings you back to the full view.',
  },
  {
    id: 'paper-types',
    target: '[data-tour="side"]',
    tab: 'paper',
    title: 'Choose your paper',
    body: 'Cartesian graph paper, millimetre, polar, semi-log, log-log, isometric, dot or blank — in white, cream, blue or board colours. You can also set the exact range of x and y.',
  },
  {
    id: 'graph',
    target: '[data-tour="side"]',
    tab: 'graph',
    title: 'Plot equations',
    body: 'Type an equation the way you would write it: y = x^2 − 4x + 3, y = 2sin(x), x^2 + y^2 = 25. Letters such as a, b and c become sliders you can drag to see the graph change. Roots and turning points can be marked.',
    action: { id: 'plot-example', label: 'Plot an example', done: 'Example plotted ✓' },
  },
  {
    id: 'draw',
    target: '[data-tour="side"]',
    tab: 'draw',
    title: 'Instruments & constructions',
    body: 'Add a ruler, protractor or set squares, drag them into place and rotate them with the handle. Draw along their edges for exact straight lines. The compass and constructions — bisectors, circumcircle, triangles from three sides — show their working arcs.',
  },
  {
    id: 'charts',
    target: '[data-tour="side"]',
    tab: 'chart',
    title: 'Statistical charts',
    body: 'Type or paste your data to get a bar chart, pie chart, histogram, ogive, scatter graph with a line of best fit, or a box plot — with the summary statistics worked out for you.',
  },
  {
    id: 'pages',
    target: '[data-tour="side"]',
    tab: 'pages',
    title: 'Pages are slides',
    body: 'Give every question or lesson step its own page, then move between them with the arrows on the paper.',
  },
  {
    id: 'present',
    target: '[data-tour="present"]',
    title: 'Teach with it',
    body: 'Present goes full screen with a laser pointer, spotlight, pen colours and page arrows — made for teaching over a video call. Press Esc or ✕ to leave.',
  },
  {
    id: 'export',
    target: '[data-tour="side"]',
    tab: 'export',
    title: 'Save & export',
    body: 'Download your work as a PNG or JPEG picture or a PDF (this page or all pages), or save a file you can reopen later. Your work is also kept automatically in this browser.',
  },
  {
    id: 'account',
    target: '[data-tour="account"]',
    title: 'Your TMP account',
    body: (c) => !c.signedIn
      ? 'Everything works without signing in. Sign in with your TMP account to save boards online — tutors can publish a board to their class, and students can submit their work to their tutor.'
      : c.role === 'tutor' || c.role === 'admin'
        ? 'You are signed in. Use Boards to save online and publish a board to your class (read-only for students). Students’ submitted work appears under “Student submissions”.'
        : c.role === 'student'
          ? 'You are signed in. Use Boards to save your work online and submit it to your tutor. Boards your tutor publishes appear under “Shared with me”.'
          : 'You are signed in. Use Boards to open work shared with you.',
  },
  {
    id: 'done',
    title: 'You’re ready',
    body: 'Pick a tool or plot an equation and start. You can replay this tour any time with the ? button at the top.',
  },
];
