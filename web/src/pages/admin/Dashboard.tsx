import { AdminDashboardLayout } from '../../components/admin/AdminDashboardLayout';
import { AdminKPICards } from '../../components/admin/AdminKPICards';
import { AdminTrafficChart } from '../../components/admin/AdminTrafficChart';
import { AdminCostDistribution } from '../../components/admin/AdminCostDistribution';
import { AdminTransactionsTable } from '../../components/admin/AdminTransactionsTable';
import { AdminNoAccessCard } from '../../components/admin/AdminNoAccessCard';
import { buildAdminPermissionKey, useAdminPermissions } from '../../utils/adminPermissions';

export function AdminDashboard() {
    const { hasPermission } = useAdminPermissions();

    const canViewKpi = hasPermission(buildAdminPermissionKey('GET', '/v0/admin/dashboard/kpi'));
    const canViewTraffic = hasPermission(buildAdminPermissionKey('GET', '/v0/admin/dashboard/traffic'));
    const canViewCost = hasPermission(
        buildAdminPermissionKey('GET', '/v0/admin/dashboard/cost-distribution')
    );
    const canViewTransactions = hasPermission(
        buildAdminPermissionKey('GET', '/v0/admin/dashboard/transactions')
    );
    const hasAnyAccess = canViewKpi || canViewTraffic || canViewCost || canViewTransactions;

    return (
        <AdminDashboardLayout>
            {!hasAnyAccess && <AdminNoAccessCard />}
            {canViewKpi && <AdminKPICards />}

            {(canViewTraffic || canViewCost) && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {canViewTraffic && <AdminTrafficChart />}

                    <div className="flex flex-col gap-6 h-full min-h-0">
                        {canViewCost && <AdminCostDistribution />}
                    </div>
                </div>
            )}

            {canViewTransactions && <AdminTransactionsTable />}
        </AdminDashboardLayout>
    );
}
