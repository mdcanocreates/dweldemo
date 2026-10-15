import type { ReactNode } from 'react';
import { Redirect } from 'wouter';
import { useAuth } from '../../hooks/useAuth';
import { getPartyRole } from '../../lib/user-flow-store';
import { getPreviewRole } from '../../lib/internal-preview';
import { getUiPreviewRole, isUiPreviewActive } from '../../lib/ui-preview';
import {
  getNetlifyDemoRole,
  isNetlifyDemoMode,
  isNetlifyDemoSessionActive,
} from '../../lib/netlify-demo';
import type { UserRole } from '../../types';

export function RequireAuth({
  children,
  roles,
  requireRoleSelection = true,
}: {
  children: ReactNode;
  roles?: UserRole[];
  requireRoleSelection?: boolean;
}) {
  const { user, loading, needsMfaEnrollment, needsMfaChallenge } = useAuth();
  const previewRole = getPreviewRole();
  const uiRole = isUiPreviewActive() ? getUiPreviewRole() : null;
  const demoRole =
    isNetlifyDemoMode() && isNetlifyDemoSessionActive() ? getNetlifyDemoRole() : null;

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-dwel-gray-500">
        Loading…
      </div>
    );
  }

  // Local UI inspection — synthetic user only; never a production session.
  if (uiRole === 'landlord' && roles?.includes('LANDLORD')) {
    return <>{children}</>;
  }
  if (uiRole === 'broker' && roles?.includes('BROKER')) {
    return <>{children}</>;
  }
  if (uiRole === 'renter' && roles?.includes('APPLICANT')) {
    return <>{children}</>;
  }

  // Standalone Netlify demo — local session only; never production auth.
  if (demoRole === 'landlord' && roles?.includes('LANDLORD')) {
    return <>{children}</>;
  }
  if (demoRole === 'broker' && roles?.includes('BROKER')) {
    return <>{children}</>;
  }
  if (demoRole === 'renter' && roles?.includes('APPLICANT')) {
    return <>{children}</>;
  }

  if (!user) return <Redirect to="/auth/login" />;

  // Authenticated allowlisted internal preview — skip MFA/role gates for preview role.
  // Does not mutate real party_role / DB memberships.
  if (previewRole === 'landlord' && roles?.includes('LANDLORD')) {
    return <>{children}</>;
  }
  if (previewRole === 'broker' && roles?.includes('BROKER')) {
    return <>{children}</>;
  }
  if (previewRole === 'renter' && roles?.includes('APPLICANT')) {
    return <>{children}</>;
  }

  if (needsMfaEnrollment) return <Redirect to="/auth/mfa/enroll" />;
  if (needsMfaChallenge) return <Redirect to="/auth/mfa/verify" />;

  const partyRole = getPartyRole();
  if (requireRoleSelection && !partyRole && !previewRole) {
    return <Redirect to="/onboarding/role" />;
  }

  if (roles) {
    const effective: UserRole =
      partyRole === 'landlord'
        ? 'LANDLORD'
        : partyRole === 'broker'
          ? 'BROKER'
          : partyRole === 'admin'
            ? 'ADMIN'
            : 'APPLICANT';
    if (!roles.includes(effective) && !roles.includes(user.role)) {
      if (partyRole === 'landlord') return <Redirect to="/dashboard" />;
      if (partyRole === 'broker') return <Redirect to="/broker/dashboard" />;
      return <Redirect to="/search" />;
    }
  }

  return <>{children}</>;
}
