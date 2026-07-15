import { Link } from 'react-router-dom';
import { useAppContext } from '../lib/AppContext';
import { supabase } from '../lib/supabase';

export default function DashboardPage({ syncStatus }: { syncStatus: string }) {
  const { session } = useAppContext();
  return (
    <div style={{ maxWidth: 480, margin: '4rem auto', textAlign: 'center' }}>
      <h1>Schoolbook</h1>
      <p>Logged in as {session.user.email}</p>
      <p>PowerSync status: {syncStatus}</p>
      <p>
        <Link to="/settings">Settings</Link>
      </p>
      <button onClick={() => supabase.auth.signOut()}>Log out</button>
    </div>
  );
}
