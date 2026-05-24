'use client';

import {
  ClerkProvider,
  OrganizationSwitcher,
  Show,
  SignInButton,
  SignUpButton,
  UserButton,
} from '@clerk/nextjs';
import { ArrowRight } from 'lucide-react';
import type { ReactNode } from 'react';

export function ClerkClientProvider({ children }: { children: ReactNode }) {
  return <ClerkProvider>{children}</ClerkProvider>;
}

export function PublicAuthActions() {
  return (
    <ClerkProvider>
      <Show when="signed-in">
        <div className="hero-actions">
          <a className="btn btn-accent" href="/dashboard">
            Dashboard
            <ArrowRight size={16} />
          </a>
          <a className="btn btn-outline" href="/pricing">
            View pricing
          </a>
        </div>
      </Show>
      <Show when="signed-out">
        <div className="hero-actions">
          <SignUpButton mode="modal">
            <button className="btn btn-accent" type="button">
              Start beta
              <ArrowRight size={16} />
            </button>
          </SignUpButton>
          <SignInButton mode="modal">
            <button className="btn btn-outline" type="button">
              Sign in
            </button>
          </SignInButton>
          <a className="btn btn-ghost" href="/pricing">
            View pricing
          </a>
        </div>
      </Show>
    </ClerkProvider>
  );
}

export function DashboardAuthControls() {
  return (
    <>
      <OrganizationSwitcher hidePersonal />
      <UserButton />
    </>
  );
}
