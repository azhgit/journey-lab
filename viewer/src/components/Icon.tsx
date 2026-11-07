// Authored icons, one stroke weight (1.6) on a 20px grid.
const PATHS = {
  arrow: "M4 10h12M11 5l5 5-5 5",
  back: "M16 10H4M9 5l-5 5 5 5",
  scissors: "M7.5 7.5 16 16M7.5 12.5 16 4M6 9a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5Zm0 7a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5Z",
  check: "M4.5 10.5 8 14l7.5-8",
  cross: "M5.5 5.5l9 9M14.5 5.5l-9 9",
  phone: "M6 3h3l1.5 4-2 1.2a9 9 0 0 0 3.3 3.3l1.2-2 4 1.5v3a2 2 0 0 1-2.2 2A14 14 0 0 1 4 5.2 2 2 0 0 1 6 3Z",
  message: "M3.5 5.5h13v8h-7l-4 3v-3h-2Z",
  play: "M7 5v10l8-5Z",
  step: "M5 5v10l7-5ZM14 5v10",
  stop: "M6 6h8v8H6Z",
  search: "M9 15a6 6 0 1 1 0-12 6 6 0 0 1 0 12Zm4.5-1.5L17 17",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, label }: { name: IconName; label?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label === undefined ? undefined : "img"}
      aria-hidden={label === undefined ? true : undefined}
      aria-label={label}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
