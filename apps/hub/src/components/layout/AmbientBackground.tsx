/**
 * The page's light.
 *
 * Three oklch blooms — verde, amarelo, azul — drifting on their own periods
 * over a black ground, a vignette that pulls the edges back to #000, and a
 * twelve-column hairline grid that fades out before it reaches the fold.
 *
 * Fixed rather than absolute: the app is many routes deep, and a layer that
 * scrolled away would leave the lower half of a long page sitting on flat
 * black. `pointer-events:none` throughout, so nothing here can swallow a click.
 *
 * The blooms are `filter: blur()` on a radial gradient rather than a huge soft
 * gradient stop — the blur is what makes the falloff read as light instead of
 * as a shape with a fuzzy edge.
 */
export function AmbientBackground() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {/* Verde · high left, the widest and warmest of the three. */}
      <div
        className="absolute rounded-full"
        style={{
          top: '-22vh',
          left: '-10vw',
          width: '70vw',
          height: '70vw',
          background:
            'radial-gradient(circle at 50% 50%, oklch(0.52 0.13 152 / 0.26), transparent 62%)',
          filter: 'blur(110px)',
          animation: 'drift 26s ease-in-out infinite',
        }}
      />
      {/* Amarelo · high right, the faintest — gold is the accent, not the ground. */}
      <div
        className="absolute rounded-full"
        style={{
          top: '8vh',
          right: '-18vw',
          width: '62vw',
          height: '62vw',
          background:
            'radial-gradient(circle at 50% 50%, oklch(0.7 0.12 96 / 0.14), transparent 60%)',
          filter: 'blur(130px)',
          animation: 'drift 34s ease-in-out infinite reverse',
        }}
      />
      {/* Azul · low centre, so scrolling walks from verde into azul. */}
      <div
        className="absolute rounded-full"
        style={{
          top: '74vh',
          left: '22vw',
          width: '66vw',
          height: '52vw',
          background:
            'radial-gradient(circle at 50% 50%, oklch(0.42 0.14 262 / 0.2), transparent 62%)',
          filter: 'blur(140px)',
          animation: 'drift 40s ease-in-out infinite',
        }}
      />

      {/* Vignette · everything past the top third returns to pure black, which is
          what keeps body copy legible over the blooms. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 80% at 50% 0%, transparent 18%, rgba(0,0,0,0.82) 76%, #000 100%)',
        }}
      />

      {/* Twelve columns, masked away before the fold — structure you feel at the
          top of a screen and stop noticing halfway down it. */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(255,255,255,0.045) 1px, transparent 1px)',
          backgroundSize: 'calc(100% / 12) 100%',
          maskImage: 'linear-gradient(to bottom, #000 0%, transparent 70%)',
          WebkitMaskImage: 'linear-gradient(to bottom, #000 0%, transparent 70%)',
        }}
      />
    </div>
  );
}
