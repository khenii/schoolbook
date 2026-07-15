import type { ReactNode } from 'react';

// The two-panel shell from 01-onboarding.html — a fixed dark "why Schoolbook"
// panel on the left, and a card on the right that swaps content per step.
// Shared across AuthScreen, SchoolSetupForm, ClassLevelSetup, and
// OnboardingSuccess so the left panel never has to be rebuilt per screen.
export default function OnboardingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="onboarding-shell page-onboarding">
      <div className="side">
        <div className="brand">
          <div className="brand-mark">S</div>
          <div className="brand-name">Schoolbook</div>
        </div>

        <div className="side-mid">
          <div className="eyebrow">Records &amp; Fees Register</div>
          <h1>One register for every class, every term, every naira.</h1>
          <p>
            Set up your school once — classes, arms, and fee items — then track admissions, payments, and balances
            all in one place. Works offline, syncs when you're back online.
          </p>
        </div>

        <div className="ledger-strip">
          <div className="ledger-row">
            <span>Class structure</span>
            <span>Kindergarten → SS3</span>
          </div>
          <div className="ledger-row">
            <span>Data isolation</span>
            <span>Per-school, always</span>
          </div>
          <div className="ledger-row">
            <span>Connectivity</span>
            <span>Offline-first</span>
          </div>
        </div>
      </div>

      <div className="main">
        <div className="card">{children}</div>
      </div>
    </div>
  );
}
