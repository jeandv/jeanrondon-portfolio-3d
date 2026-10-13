import type { Tape } from './types'

// TODO(Jean): replace every placeholder below with real companies/projects.
// Keep at most 8 tapes; `slot` 1–8 must be unique (it maps to the GLB node tape_0N).
export const TAPES: readonly Tape[] = [
  {
    id: 'company-one',
    slot: 1,
    kind: 'company',
    title: 'Company One',
    years: '2024 — Now',
    role: 'Senior Frontend Engineer',
    summary: 'Placeholder summary of the role and the product.',
    bullets: ['Placeholder achievement one.', 'Placeholder achievement two.', 'Placeholder achievement three.'],
    stack: ['Angular', 'TypeScript', 'Signals'],
  },
  {
    id: 'company-two',
    slot: 2,
    kind: 'company',
    title: 'Company Two',
    years: '2022 — 2024',
    role: 'Frontend Engineer',
    summary: 'Placeholder summary of the role and the product.',
    bullets: ['Placeholder achievement one.', 'Placeholder achievement two.'],
    stack: ['React', 'TypeScript', 'Redux'],
  },
  {
    id: 'company-three',
    slot: 3,
    kind: 'company',
    title: 'Company Three',
    years: '2020 — 2022',
    role: 'Frontend Developer',
    summary: 'Placeholder summary of the role and the product.',
    bullets: ['Placeholder achievement one.', 'Placeholder achievement two.'],
    stack: ['Angular', 'RxJS'],
  },
  {
    id: 'company-four',
    slot: 4,
    kind: 'company',
    title: 'Company Four',
    years: '2018 — 2020',
    role: 'Web Developer',
    summary: 'Placeholder summary of the role and the product.',
    bullets: ['Placeholder achievement one.', 'Placeholder achievement two.'],
    stack: ['JavaScript', 'CSS'],
  },
  {
    id: 'company-five',
    slot: 5,
    kind: 'company',
    title: 'Company Five',
    years: '2016 — 2018',
    role: 'Junior Developer',
    summary: 'Placeholder summary of the role and the product.',
    bullets: ['Placeholder achievement one.'],
    stack: ['HTML', 'CSS', 'JavaScript'],
  },
  {
    id: 'project-one',
    slot: 6,
    kind: 'project',
    title: 'Project One',
    years: '2025',
    role: 'Author',
    summary: 'Placeholder summary of the project.',
    bullets: ['Placeholder highlight one.', 'Placeholder highlight two.'],
    stack: ['React Three Fiber', 'Three.js'],
    url: 'https://github.com/your-user/project-one',
  },
  {
    id: 'project-two',
    slot: 7,
    kind: 'project',
    title: 'Project Two',
    years: '2024',
    role: 'Author',
    summary: 'Placeholder summary of the project.',
    bullets: ['Placeholder highlight one.'],
    stack: ['TypeScript', 'Node.js'],
    url: 'https://github.com/your-user/project-two',
  },
  {
    id: 'project-three',
    slot: 8,
    kind: 'project',
    title: 'Project Three',
    years: '2023',
    role: 'Author',
    summary: 'Placeholder summary of the project.',
    bullets: ['Placeholder highlight one.'],
    stack: ['Go', 'Bubbletea'],
    url: 'https://github.com/your-user/project-three',
  },
]

export const TAPE_IDS: ReadonlySet<string> = new Set(TAPES.map((tape) => tape.id))

export function tapeById(id: string | undefined): Tape | undefined {
  return id === undefined ? undefined : TAPES.find((tape) => tape.id === id)
}

export function tapeBySlot(slot: number): Tape | undefined {
  return TAPES.find((tape) => tape.slot === slot)
}

/** GLB node name for a shelf slot (1 → `tape_01`). */
export function tapeNodeName(slot: number): string {
  return `tape_${String(slot).padStart(2, '0')}`
}
