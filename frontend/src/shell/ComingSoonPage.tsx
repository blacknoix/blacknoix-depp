interface Props {
  title: string;
  description: string;
}

/**
 * Honest placeholder for nav destinations that are not implemented yet.
 */
export function ComingSoonPage({ title, description }: Props) {
  return (
    <section className="coming-soon" aria-label={`${title} — coming soon`}>
      <p className="brand">DEPP</p>
      <h1>{title}</h1>
      <p className="lede">{description}</p>
      <p className="banner" role="status">
        This surface is not implemented yet. Navigation is reserved so future
        operator workflows have a stable home.
      </p>
    </section>
  );
}
