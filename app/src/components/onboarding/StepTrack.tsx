// The 1-2-3 dot tracker from 01-onboarding.html's signup flow. The real
// app's three steps (create login → school details → class levels) don't
// line up 1:1 with the mockup's steps (school+login together, then class
// levels, then a success screen) since Supabase Auth requires the login to
// exist before a school can be created against it — but the same three-dot
// visual language still applies cleanly to our three real steps.
export default function StepTrack({ current }: { current: 1 | 2 | 3 }) {
  return (
    <div className="step-track">
      {[1, 2, 3].map((n) => (
        <div key={n} style={{ display: 'contents' }}>
          {n > 1 && <div className="step-line" />}
          <div className={`step-dot${n < current ? ' done' : n === current ? ' current' : ''}`}>
            {n < current ? '✓' : n}
          </div>
        </div>
      ))}
    </div>
  );
}
