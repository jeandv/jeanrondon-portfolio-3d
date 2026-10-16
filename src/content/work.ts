import type { Tape } from './types'

// TODO(Jean): replace every placeholder below with real companies/projects.
// Keep at most 8 tapes; `slot` 1–8 must be unique (it maps to the GLB node tape_0N).
export const TAPES: readonly Tape[] = [
  {
    id: 'company-one',
    slot: 1,
    kind: 'company',
    title: 'IA interactive',
    years: '2023 — 2026',
    role: 'Frontend Engineer - Mexico',
    summary: 'Developing for Cinépolis, a leading global cinema chain serving across Latin America, Spain, and India.',
    bullets: ['Contributed to full-platform, web and desktop app.', 'Implemented a microfrontend architecture.', 'Mentored new developers, working within all teams.'],
    stack: ['TypeScript', 'React.js', 'Next.js', 'TanStack Query'],
  },
  {
    id: 'company-two',
    slot: 2,
    kind: 'company',
    title: 'Zima Blue',
    years: '2025',
    role: 'Full Stack Engineer - Portugal',
    summary: 'Integrated Sanity CMS with Next.js, ensuring a smooth connection between the CMS and the frontend.',
    bullets: ['Structured the architecture with a focus on scalability and maintainability.'],
    stack: ['TypeScript', 'React.js', 'Sanity CMS', 'Tailwind CSS'],
  },
  {
    id: 'company-three',
    slot: 3,
    kind: 'company',
    title: 'Studio Iluxion',
    years: '2021 - 2022',
    role: 'Frontend Developer - Peru',
    summary: 'Frontend Developer and Web Designer UX, ensuring pixel-perfect implementation across all projects.',
    bullets: ['Landing pages and multi-section websites, Manageable e-commerce stores.'],
    stack: ['JavaScript', 'React.js', 'Tailwind CSS', 'Figma'],
  },
  {
    id: 'project-one',
    slot: 4,
    kind: 'project',
    title: 'Cinépolis',
    years: '',
    role: 'IA interactive',
    summary: '',
    bullets: [''],
    stack: [''],
    url: 'https://cinepolis.com',
  },
  {
    id: 'project-two',
    slot: 5,
    kind: 'project',
    title: 'MiPlatita',
    years: '',
    role: 'Me',
    summary: '',
    bullets: [''],
    stack: [''],
    url: 'https://miplatita.vercel.app/',
  },
  {
    id: 'project-three',
    slot: 6,
    kind: 'project',
    title: 'Ecommerce',
    years: '',
    role: 'Me',
    summary: '',
    bullets: [''],
    stack: [''],
    url: 'https://jeanrondon-shop.vercel.app/',
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
