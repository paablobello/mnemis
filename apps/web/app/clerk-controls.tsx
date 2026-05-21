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
          <a className="primary-action" href="/dashboard">
            Dashboard
            <ArrowRight size={18} />
          </a>
          <a className="secondary-action" href="/pricing">
            View pricing
          </a>
        </div>
      </Show>
      <Show when="signed-out">
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
          <a className="secondary-action" href="/pricing">
            View pricing
          </a>
        </div>
      </Show>
    </ClerkProvider>
  );
}

export function DashboardAuthControls() {
  return (
    <ClerkProvider>
      <OrganizationSwitcher hidePersonal />
      <UserButton />
    </ClerkProvider>
  );
}
