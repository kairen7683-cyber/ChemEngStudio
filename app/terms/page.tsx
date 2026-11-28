import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Terms of Service — ChemPlant Studio',
  description: 'Terms of Service for ChemPlant Studio web-native chemical process simulator and equipment design suite.',
};

export default function TermsPage() {
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
        <h1 style={{ fontSize: 26, fontWeight: 900, margin: '0 0 6px' }}>Terms of Service</h1>
        <p style={{ fontSize: 12.5, color: '#64748B', margin: '0 0 28px', fontFamily: 'JetBrains Mono, monospace' }}>
          Effective Date: November 2026 · https://chemplantstudio.com
        </p>

        <section style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 12, padding: 24, display: 'flex', flexDirection: 'column', gap: 18, fontSize: 13.5, lineHeight: 1.7, color: '#334155' }}>
          <div>
            <h2 style={{ fontSize: 15.5, fontWeight: 800, color: '#0F172A', margin: '0 0 6px' }}>1. Service Description</h2>
            <p style={{ margin: 0 }}>
              ChemPlant Studio (<strong>https://chemplantstudio.com</strong>) provides a web-based chemical process flowsheet simulator, heat exchanger rating tool, pressure relief / flare sizing modules, and engineering datasheet export capabilities.
            </p>
          </div>
          <div>
            <h2 style={{ fontSize: 15.5, fontWeight: 800, color: '#0F172A', margin: '0 0 6px' }}>2. Engineering Disclaimer &amp; Professional Responsibility</h2>
            <p style={{ margin: 0 }}>
              All simulation results, thermodynamic calculations, equipment sizing outputs, and cost estimates are provided as preliminary engineering aids. Final plant construction, mechanical design, pressure vessel fabrication, and safety relief (PSV/Flare) installations must be independently verified and stamped by a licensed Professional Engineer (PE) in accordance with applicable ASME, TEMA, API, and local regulatory codes.
            </p>
          </div>
          <div>
            <h2 style={{ fontSize: 15.5, fontWeight: 800, color: '#0F172A', margin: '0 0 6px' }}>3. Accounts &amp; Acceptable Use</h2>
            <p style={{ margin: 0 }}>
              Users are responsible for maintaining the confidentiality of their login credentials and for all activity under their account. Automated scraping, reverse engineering, unauthorized access to restricted resources, or abusive server load is prohibited.
            </p>
          </div>
          <div>
            <h2 style={{ fontSize: 15.5, fontWeight: 800, color: '#0F172A', margin: '0 0 6px' }}>4. Subscriptions &amp; Billing</h2>
            <p style={{ margin: 0 }}>
              Paid plans (Pro Engineer / Team) are billed on a recurring monthly or annual basis through our Merchant of Record payment partner. You may cancel auto-renewal at any time; access remains active through the end of the current billing cycle. See our{' '}
              <Link href="/refund" style={{ color: '#1E3A8A', fontWeight: 700 }}>14-Day Refund Policy</Link>.
            </p>
          </div>
          <div>
            <h2 style={{ fontSize: 15.5, fontWeight: 800, color: '#0F172A', margin: '0 0 6px' }}>5. Contact</h2>
            <p style={{ margin: 0 }}>
              For legal, licensing, or service inquiries, please contact{' '}
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
