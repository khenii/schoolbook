import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { PowerSyncContext } from '@powersync/react';
import type { Session } from '@supabase/supabase-js';
import { powersync, connectPowerSync } from './lib/powersync';
import { supabase } from './lib/supabase';

function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1>Schoolbook</h1>
      <input
        type="email"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <input
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      <button type="submit">Log in</button>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
    </form>
  );
}

function Dashboard({ session }: { session: Session }) {
  const [status, setStatus] = useState('connecting…');

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    connectPowerSync()
      .then(() => setStatus('connected'))
      .catch((err) => setStatus(`error: ${err.message}`));

    unsubscribe = powersync.registerListener({
      statusChanged: (s) => setStatus(s.connected ? 'synced' : 'offline — changes queued locally')
    });

    return () => unsubscribe?.();
  }, []);

  return (
    <div style={{ maxWidth: 480, margin: '4rem auto', textAlign: 'center' }}>
      <h1>Schoolbook</h1>
      <p>Logged in as {session.user.email}</p>
      <p>PowerSync status: {status}</p>
      <button onClick={() => supabase.auth.signOut()}>Log out</button>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));

    return () => subscription.unsubscribe();
  }, []);

  if (loading) return <p style={{ textAlign: 'center', marginTop: '4rem' }}>Loading…</p>;

  return (
    <PowerSyncContext.Provider value={powersync}>
      {session ? <Dashboard session={session} /> : <LoginForm />}
    </PowerSyncContext.Provider>
  );
}
