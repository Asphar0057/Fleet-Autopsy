// Panel section header (Requirement 3.1): serif title plus one grey sentence.
import type { ReactNode } from 'react';

export function SectionHead({ title, note }: { title: string; note?: ReactNode }) {
  return (
    <header className="section-head">
      <h2 className="section-title">{title}</h2>
      {note !== undefined && <p className="section-note">{note}</p>}
    </header>
  );
}
