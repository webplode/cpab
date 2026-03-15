import { DashboardLayout } from '../components/DashboardLayout';
import { KPICards } from '../components/KPICards';
import { TrafficChart } from '../components/TrafficChart';
import { CostDistribution } from '../components/CostDistribution';
import { TransactionsTable } from '../components/TransactionsTable';

export function Dashboard() {
    return (
        <DashboardLayout>
            <KPICards />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <TrafficChart />

                <div className="flex flex-col gap-6 h-full min-h-0">
                    <CostDistribution />
                </div>
            </div>

            <TransactionsTable />
        </DashboardLayout>
    );
}
