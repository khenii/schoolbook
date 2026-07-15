import { useState } from 'react';
import type { FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { NIGERIAN_STATES } from '../lib/nigerianStates';
import OnboardingLayout from './OnboardingLayout';
import StepTrack from './onboarding/StepTrack';

// Step 2 of the real signup flow — "Register your school" per
// 01-onboarding.html's copy, though the fields differ: the mockup's step 1
// already asked for the school name, so its step 2 is class levels. Here
// the login was step 1, so this step collects the school's actual identity
// (name, state, city, contact) before class levels become step 3.
export default function SchoolSetupForm({
  onComplete
}: {
  onComplete: (schoolId: string, schoolName: string) => void;
}) {
  const [schoolName, setSchoolName] = useState('');
  const [state, setState] = useState('');
  const [city, setCity] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('create_school_and_first_account', {
        p_school_name: schoolName,
        p_state: state,
        p_city: city,
        p_contact_email: contactEmail || null,
        p_contact_phone: contactPhone || null
      });
      if (error) throw error;
      onComplete(data as string, schoolName);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <OnboardingLayout>
      <StepTrack current={2} />
      <h2 className="form-title">Register your school</h2>
      <div className="form-sub">
        This creates a private, isolated workspace — your records are never visible to any other school on
        Schoolbook.
      </div>

      <form onSubmit={handleSubmit}>
        <div className="field">
          <label>School name</label>
          <input
            type="text"
            placeholder="e.g. Bright Path College"
            value={schoolName}
            onChange={(e) => setSchoolName(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label>State</label>
          <select value={state} onChange={(e) => setState(e.target.value)} required>
            <option value="" disabled>
              Select state
            </option>
            {NIGERIAN_STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>City</label>
          <input type="text" placeholder="e.g. Lekki" value={city} onChange={(e) => setCity(e.target.value)} required />
        </div>
        <div className="field">
          <label>Contact email (optional)</label>
          <input
            type="email"
            placeholder="e.g. admin@brightpath.edu.ng"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
          />
        </div>
        <div className="field">
          <label>Contact phone (optional)</label>
          <input
            type="text"
            placeholder="e.g. 080..."
            value={contactPhone}
            onChange={(e) => setContactPhone(e.target.value)}
          />
        </div>

        <button className="btn-primary" type="submit" disabled={loading}>
          {loading ? 'Setting up…' : 'Continue'}
        </button>
        {error && (
          <p className="field-error" style={{ display: 'block' }}>
            {error}
          </p>
        )}
      </form>
    </OnboardingLayout>
  );
}
