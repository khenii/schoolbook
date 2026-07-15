import { useState } from 'react';
import type { FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { NIGERIAN_STATES } from '../lib/nigerianStates';

export default function SchoolSetupForm({ onComplete }: { onComplete: (schoolId: string) => void }) {
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
      onComplete(data as string);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1>Set up your school</h1>
      <input
        placeholder="School name"
        value={schoolName}
        onChange={(e) => setSchoolName(e.target.value)}
        required
      />
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
      <input placeholder="City" value={city} onChange={(e) => setCity(e.target.value)} required />
      <input
        placeholder="Contact email (optional)"
        value={contactEmail}
        onChange={(e) => setContactEmail(e.target.value)}
      />
      <input
        placeholder="Contact phone (optional)"
        value={contactPhone}
        onChange={(e) => setContactPhone(e.target.value)}
      />
      <button type="submit" disabled={loading}>
        {loading ? 'Setting up…' : 'Continue'}
      </button>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
    </form>
  );
}
