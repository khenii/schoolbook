import OnboardingLayout from './OnboardingLayout';

// Step-3 success screen from 01-onboarding.html — the previous version of
// this flow skipped straight from class levels to the dashboard with no
// confirmation. Added back since it's a real, easy piece of the mockup's
// design and gives a clear moment of "this worked."
export default function OnboardingSuccess({
  schoolName,
  levelCount,
  onContinue
}: {
  schoolName: string;
  levelCount: number;
  onContinue: () => void;
}) {
  return (
    <OnboardingLayout>
      <div className="center-text">
        <div className="success-badge">✓</div>
        <h2 className="form-title">You're all set, {schoolName}</h2>
        <div className="form-sub">
          Your school workspace has been created with {levelCount} class level{levelCount === 1 ? '' : 's'}. Next,
          you can add arms (e.g. SS3 A, B, C), set up fee items, and start enrolling students.
        </div>
        <button className="btn-primary" onClick={onContinue}>
          Go to dashboard
        </button>
      </div>
    </OnboardingLayout>
  );
}
