// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

// Line icons for the console (24 × 24, stroked with the text colour).
const PATHS = {
  issue: [
    'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z',
    'M14 3v5h5',
    'M12 11v6',
    'M9 14h6',
  ],
  lifecycle: [
    'M21 12a9 9 0 0 1-15.5 6.2',
    'M3 12A9 9 0 0 1 18.5 5.8',
    'M18.5 2v3.8h-3.8',
    'M5.5 22v-3.8h3.8',
  ],
  verify: ['M12 3l7 3v6c0 4.5-3 7.8-7 9-4-1.2-7-4.5-7-9V6z', 'M9 12l2 2 4-4'],
  governance: [
    'M3 10h18',
    'M5 10v8',
    'M9.5 10v8',
    'M14.5 10v8',
    'M19 10v8',
    'M3 21h18',
    'M12 3l9 5H3z',
  ],
  accreditation: [
    'M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16',
    'M16 9h2a2 2 0 0 1 2 2v10',
    'M3 21h18',
    'M8 7h4',
    'M8 11h4',
    'M8 15h4',
  ],
  schemas: ['M12 3l9 5-9 5-9-5z', 'M3 12.5l9 5 9-5', 'M3 17l9 5 9-5'],
  audit: [
    'M9 4h6a1 1 0 0 1 1 1v1H8V5a1 1 0 0 1 1-1z',
    'M8 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2',
    'M8 11h8',
    'M8 15h5',
  ],
  logout: ['M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3', 'M10 17l-5-5 5-5', 'M5 12h11'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  copy: ['M8 8h11v11H8z', 'M5 16H4V5h11v1'],
  edit: ['M4 20h4l11-11-4-4L4 16z', 'M13.5 6.5l4 4'],
};

/**
 * Render a known existing navigation symbol as a decorative SVG.
 * @param options - Existing component inputs: {name, size = 18}.
 * @returns The rendered React content.
 */
export default function Icon(options: { name: string; size?: number }) {
  const { name, size = 18 } = options;

  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {(PATHS[name] || []).map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
