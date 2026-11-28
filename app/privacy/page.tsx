import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacy Policy — ChemPlant Studio',
  description: 'Privacy Policy for ChemPlant Studio describing how user account and workspace data are handled.',
};

export default function PrivacyPage() {
  return (
    <div style={{ minHeight: '100vh', background: '#F8FAFC', color: '#0F172A', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <header style={{ background: '#0F172A', color: '#F8FAFC', padding: '14px 24px', borderBottom: '1px solid #1E293B' }}>
        <div style={{ maxWidth: 820, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Link href="/" style={{ color: '#F8FAFC', textDecoration: 'none', fontWeight: 900, fontSize: 15 }}>
            ChemPlant Studio
          </Link>
          <Link href="/" style={{ color: '#93C5FD', textDecoration: 'none', fontSize: 12.5, fontWeight: 700 }}>
            ← Back to Home
          </Link>
        </div>
      </header>
      <main style={{ maxWidth: 820, margin: '0 auto', padding: '36px 24px 64px' }}>
        <h1 style={{ fontSize: 26, fontWeight: 900, margin: '0 0 6px' }}>Privacy Policy</h1>
        <p style={{ fontSize: 12.5, color: '#64748B', margin: '0 0 28px', fontFamily: 'JetBrains Mono, monospace' }}>
          Effective Date: November 2026 · https://chemplantstudio.com
        </p>

        <section style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 12, padding: 24, display: 'flex', flexDirection: 'column', gap: 18, fontSize: 13.5, lineHeight: 1.7, color: '#334155' }}>
          <div>
            <h2 style={{ fontSize: 15.5, fontWeight: 800, color: '#0F172A', margin: '0 0 6px' }}>1. Information We Collect</h2>
            <p style={{ margin: 0 }}>
              We collect only the minimum information required to operate your account: email address, username, hashed password (PBKDF2-SHA256), session cookies, and the process flowsheet cases you explicitly choose to save to your private cloud workspace.
            </p>
          </div>
          <div>
            <h2 style={{ fontSize: 15.5, fontWeight: 800, color: '#0F172A', margin: '0 0 6px' }}>2. How We Use Your Data</h2>
            <p style={{ margin: 0 }}>
              Your data is used strictly for authentication, private workspace synchronization, subscription verification, and technical support responses. Your private process flowsheets are isolated per user and are never sold, shared with third parties, or used to train external AI models.
            </p>
          </div>
          <div>
            <h2 style={{ fontSize: 15.5, fontWeight: 800, color: '#0F172A', margin: '0 0 6px' }}>3. Payment Information</h2>
            <p style={{ margin: 0 }}>
              Payment card details are processed directly by our Merchant of Record payment provider and are never stored on ChemPlant Studio servers.
            </p>
          </div>
          <div>
            <h2 style={{ fontSize: 15.5, fontWeight: 800, color: '#0F172A', margin: '0 0 6px' }}>4. Data Rights &amp; Deletion</h2>
            <p style={{ margin: 0 }}>
              You may request access, export (JSON/Excel), correction, or permanent deletion of your account and saved workspaces at any time by emailing{' '}
              <a href="mailto:support@chemplantstudio.com" style={{ color: '#1E3A8A', fontWeight: 700 }}>
                support@chemplantstudio.com
              </a>.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
