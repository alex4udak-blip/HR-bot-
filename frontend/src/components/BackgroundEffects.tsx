export default function BackgroundEffects() {
  return (
    <>
      {/* Premium gradient background */}
      <div className="premium-bg" />

      {/* Grid pattern */}
      <div className="grid-pattern" />

      {/* Floating orbs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none" style={{ zIndex: -1 }}>
        <div className="floating-orb orb-1" />
        <div className="floating-orb orb-2" />
        <div className="floating-orb orb-3" />
      </div>

      {/* Subtle noise texture */}
      <div className="noise-overlay" />
    </>
  );
}
