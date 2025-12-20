export default function BackgroundEffects() {
  return (
    <>
      {/* Premium gradient background */}
      <div className="premium-bg" />

      {/* Aurora rotating effect */}
      <div className="aurora" />

      {/* Light rays with smooth gradients */}
      <div className="light-rays" />

      {/* Grid pattern with pulse */}
      <div className="grid-pattern" />

      {/* Floating orbs - enhanced */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none" style={{ zIndex: -1 }}>
        <div className="floating-orb orb-1" />
        <div className="floating-orb orb-2" />
        <div className="floating-orb orb-3" />
        <div className="floating-orb orb-4" />
      </div>

      {/* Floating particles */}
      <div className="particles">
        <div className="particle" />
        <div className="particle" />
        <div className="particle" />
        <div className="particle" />
        <div className="particle" />
        <div className="particle" />
        <div className="particle" />
      </div>

      {/* Subtle noise texture */}
      <div className="noise-overlay" />
    </>
  );
}
