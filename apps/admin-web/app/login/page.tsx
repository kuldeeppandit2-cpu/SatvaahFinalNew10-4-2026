'use client';
import { useState } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);
  const router = useRouter();

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      // Firebase login — token used directly for admin API calls
      const credential = await signInWithEmailAndPassword(auth, email, password);
      const firebaseToken = await credential.user.getIdToken();
      // Store Firebase token — requireAdmin now accepts it directly
      sessionStorage.setItem('admin_token', firebaseToken);
      router.push('/');
    } catch (err: unknown) {
      setError((err as Error).message ?? 'Login failed');
    } finally { setLoading(false); }
  }

  return (
    <div className="min-h-screen bg-deep-ink flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-xl p-10 w-full max-w-sm">
        <div className="text-saffron font-bold text-2xl mb-1">SatvAAh</div>
        <div className="text-gray-500 text-sm mb-8">Admin Portal — authorised personnel only</div>
        <form onSubmit={handleLogin} className="flex flex-col gap-4">
          <input
            type="email" placeholder="Email address" required value={email}
            onChange={e => setEmail(e.target.value)}
            className="px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-verdigris"
          />
          <input
            type="password" placeholder="Password" required value={password}
            onChange={e => setPassword(e.target.value)}
            className="px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-verdigris"
          />
          {error && <p className="text-terracotta text-xs">{error}</p>}
          <button
            type="submit" disabled={loading}
            className="bg-verdigris hover:bg-green-800 text-white py-3 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p className="text-gray-400 text-xs text-center mt-6">
          Admin accounts are provisioned by SatvAAh engineering team only.
        </p>
      </div>
    </div>
  );
}
