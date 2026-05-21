import { SignInButton, SignUpButton } from '@clerk/nextjs';
import { auth } from '@clerk/nextjs/server';
import { ArrowRight, DatabaseZap, FileSearch, KeyRound, Radar } from 'lucide-react';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const { userId } = await auth();
  if (userId) redirect('/dashboard');

  return (
    <main className="public-shell">
      <section className="public-hero">
        <div className="brand-mark">
          <Radar size={20} />
          <span>Mnemis</span>
        </div>
        <h1>Agent memory and research infrastructure.</h1>
        <p>
          Hosted workspace control for MCP agents, indexed sources, cited search, PDFs, papers, and
          repeatable research runs.
        </p>
        <div className="hero-actions">
          <SignUpButton mode="modal">
            <button className="primary-action" type="button">
              Start beta
              <ArrowRight size={18} />
            </button>
          </SignUpButton>
          <SignInButton mode="modal">
            <button className="secondary-action" type="button">
              Sign in
            </button>
          </SignInButton>
        </div>
      </section>

      <section className="public-grid" aria-label="Product areas">
        <article>
          <DatabaseZap size={22} />
          <h2>Persistent agent memory</h2>
          <p>Typed memory, scopes, TTLs, workspace isolation, and retrieval through MCP.</p>
        </article>
        <article>
          <FileSearch size={22} />
          <h2>Research and indexing</h2>
          <p>Web, docs, papers, PDFs, Firecrawl, OpenAlex, Tavily, Exa, and worker jobs.</p>
        </article>
        <article>
          <KeyRound size={22} />
          <h2>Production controls</h2>
          <p>API keys, usage credits, billing state, source status, and beta observability.</p>
        </article>
      </section>
    </main>
  );
}
