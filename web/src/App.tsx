import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { Homepage } from './pages/Homepage';
import { ApiKeys } from './pages/ApiKeys';
import { Billing } from './pages/Billing';
import { Logs } from './pages/Logs';
import { ModelsPricing } from './pages/ModelsPricing';
import { Plan } from './pages/plan';
import { Init } from './pages/Init';
import { Settings } from './pages/Settings';
import { TOKEN_KEY_ADMIN } from './api/config';
import { AdminDashboard } from './pages/admin/Dashboard';
import { AdminUsers } from './pages/admin/Users';
import { AdminUserGroups } from './pages/admin/UserGroups';
import { AdminAuthGroups } from './pages/admin/AuthGroups';
import { AdminAuthFiles } from './pages/admin/AuthFiles';
import { AdminQuotas } from './pages/admin/Quotas';
import { AdminModels } from './pages/admin/Models';
import { AdminApiKeys } from './pages/admin/ApiKeys';
import { AdminProxies } from './pages/admin/Proxies';
import { AdminPlans } from './pages/admin/Plans';
import { AdminBills } from './pages/admin/Bills';
import { AdminBillingRules } from './pages/admin/BillingRules';
import { AdminPrepaidCards } from './pages/admin/PrepaidCards';
import { AdminLogs } from './pages/admin/Logs';
import { AdminSettings } from './pages/admin/Settings';
import { AdminAdministrators } from './pages/admin/Administrators';
import { AdminLogin } from './pages/admin/Login';

function AdminEntryRedirect() {
    const isLoggedIn = Boolean(localStorage.getItem(TOKEN_KEY_ADMIN));
    return <Navigate to={isLoggedIn ? '/admin/dashboard' : '/admin/login'} replace />;
}

function App() {
    return (
        <BrowserRouter>
            <Routes>
                <Route path="/" element={<Homepage />} />
                <Route path="/init" element={<Init />} />
                <Route path="/login" element={<Login />} />
                <Route path="/register" element={<Register />} />
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/api-keys" element={<ApiKeys />} />
                <Route path="/billing" element={<Billing />} />
                <Route path="/logs" element={<Logs />} />
                <Route path="/models" element={<ModelsPricing />} />
                <Route path="/plans" element={<Plan />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/admin" element={<AdminEntryRedirect />} />
                <Route path="/admin/dashboard" element={<AdminDashboard />} />
                <Route path="/admin/login" element={<AdminLogin />} />
                <Route path="/admin/users" element={<AdminUsers />} />
                <Route path="/admin/user-groups" element={<AdminUserGroups />} />
                <Route path="/admin/auth-groups" element={<AdminAuthGroups />} />
                <Route path="/admin/auth-files" element={<AdminAuthFiles />} />
                <Route path="/admin/quotas" element={<AdminQuotas />} />
                <Route path="/admin/models" element={<AdminModels />} />
                <Route path="/admin/api-keys" element={<AdminApiKeys />} />
                <Route path="/admin/proxies" element={<AdminProxies />} />
                <Route path="/admin/prepaid-cards" element={<AdminPrepaidCards />} />
                <Route path="/admin/plans" element={<AdminPlans />} />
                <Route path="/admin/bills" element={<AdminBills />} />
                <Route path="/admin/billing-rules" element={<AdminBillingRules />} />
                <Route path="/admin/administrators" element={<AdminAdministrators />} />
                <Route path="/admin/logs" element={<AdminLogs />} />
                <Route path="/admin/settings" element={<AdminSettings />} />
            </Routes>
        </BrowserRouter>
    );
}

export default App;
