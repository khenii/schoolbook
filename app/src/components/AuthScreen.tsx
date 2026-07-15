import { useState } from 'react';
import type { FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import OnboardingLayout from './OnboardingLayout';
import StepTrack from './onboarding/StepTrack';

// The tabs("Create school account" / "Log in") from 01-onboarding.html.
// The mockup's step-1 signup form collects school name + admin email +
// password in one screen; the real flow can only create a Supabase Auth
// user first (email + password), then the school itself as a separate step
// (SchoolSetupForm) once that login exists — so this step only asks for the
// login, and says so, rather than pretending to collect the school name
// here too.
export default function AuthScreen() {
  const [mode, setMode] = useState<'login' | 'signup'>('signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function switchMode(next: 'login' | 'signup') {
    setMode(next);
    setError(null);
    setInfo(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (!data.session) {
          setInfo('Check your email to confirm your account, then log in.');
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <OnboardingLayout>
      <div className="tabs">
        <div className={`tab${mode === 'signup' ? ' active' : ''}`} onClick={() => switchMode('signup')}>
          Create school account
        </div>
        <div className={`tab${mode === 'login' ? ' active' : ''}`} onClick={() => switchMode('login')}>
          Log in
        </div>
      </div>

      {mode === 'signup' ? (
        <form onSubmit={handleSubmit}>
          <StepTrack current={1} />
          <h2 className="form-title">Create your login</h2>
          <div className="form-sub">
            First, create the account you'll sign in with — your school's own name and details come next.
          </div>

          <div className="field">
            <label>Admin email</label>
            <input
              type="email"
              placeholder="e.g. admin@brightpath.edu.ng"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label>Password</label>
            <input
              type="password"
              placeholder="Create a password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
            <div className="field-hint">You'll use this to log in going forward — one login per school for now.</div>
          </div>

          <button className="btn-primary" type="submit" disabled={loading}>
            {loading ? 'Please wait…' : 'Continue'}
          </button>
          {error && (
            <p className="field-error" style={{ display: 'block' }}>
              {error}
            </p>
          )}
          {info && <p style={{ color: 'var(--success)', fontSize: 12.5, marginTop: 10 }}>{info}</p>}

          <div className="foot-link">
            Already have a school account? <a onClick={() => switchMode('login')}>Log in</a>
          </div>
        </form>
      ) : (
        <form onSubmit={handleSubmit}>
          <h2 className="form-title">Welcome back</h2>
          <div className="form-sub">Log in to your school's workspace.</div>

          <div className="field">
            <label>Admin email</label>
            <input
              type="email"
              placeholder="e.g. admin@brightpath.edu.ng"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label>Password</label>
            <input
              type="password"
              placeholder="Your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button className="btn-primary" type="submit" disabled={loading}>
            {loading ? 'Please wait…' : 'Log in'}
          </button>
          {error && (
            <p className="field-error" style={{ display: 'block' }}>
              {error}
            </p>
          )}

          <div className="foot-link">
            New school? <a onClick={() => switchMode('signup')}>Create an account</a>
          </div>
        </form>
      )}
    </OnboardingLayout>
  );
}
