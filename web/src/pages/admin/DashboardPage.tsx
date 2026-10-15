import { AdminShell } from '../../components/layout/AdminShell';

export function AdminDashboardPage() {
  return (
    <AdminShell>
      <h1 className="text-3xl font-semibold">Admin</h1>
      <p className="mt-2 text-sm text-dwel-gray-500">
        Use the sidebar for RS tiers, landlords, state rules, credits, flags, and match-reason audit.
      </p>
    </AdminShell>
  );
}
