import { useState, useEffect } from 'react';
import { apiFetch } from '../api/config';
import { useTranslation } from 'react-i18next';

interface Transaction {
    status: string;
    status_type: 'success' | 'error';
    timestamp: string;
    method: string;
    model: string;
    tokens: number;
    cost_micros: number;
}

interface TransactionsData {
    transactions: Transaction[];
}

function formatTokens(tokens: number): string {
    if (tokens === 0) return '0';
    return tokens.toLocaleString();
}

export function TransactionsTable() {
    const { t } = useTranslation();
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        apiFetch<TransactionsData>('/v0/front/dashboard/transactions')
            .then((res) => setTransactions(res.transactions || []))
            .catch(console.error)
            .finally(() => setLoading(false));
    }, []);

    return (
        <div className="bg-white dark:bg-surface-dark rounded-xl border border-gray-200 dark:border-border-dark shadow-sm overflow-hidden">
            <div className="px-6 py-5 border-b border-gray-200 dark:border-border-dark flex justify-between items-center">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                    {t('Recent Requests')}
                </h3>
                <a
                    href="/logs"
                    className="text-sm font-medium text-primary hover:text-blue-400 transition-colors"
                >
                    {t('View All Logs →')}
                </a>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 dark:bg-background-dark text-slate-500 dark:text-text-secondary uppercase text-xs font-semibold">
                        <tr>
                            <th className="px-6 py-4">{t('Status')}</th>
                            <th className="px-6 py-4">{t('Timestamp')}</th>
                            <th className="px-6 py-4">{t('Method')}</th>
                            <th className="px-6 py-4">{t('Model')}</th>
                            <th className="px-6 py-4">{t('Tokens')}</th>
                            <th className="px-6 py-4">{t('Cost')}</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-border-dark">
                        {loading ? (
                            [...Array(5)].map((_, i) => (
                                <tr key={i}>
                                    <td colSpan={6} className="px-6 py-4">
                                        <div className="animate-pulse h-4 bg-slate-200 dark:bg-border-dark rounded"></div>
                                    </td>
                                </tr>
                            ))
                        ) : transactions.length === 0 ? (
                            <tr>
                                <td colSpan={6} className="px-6 py-8 text-center text-slate-500 dark:text-text-secondary">
                                    {t('No transactions yet')}
                                </td>
                            </tr>
                        ) : (
                            transactions.map((tx, index) => (
                                <tr
                                    key={index}
                                    className="hover:bg-slate-50 dark:hover:bg-background-dark/30 transition-colors"
                                >
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <span
                                            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                                                tx.status_type === 'success'
                                                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20'
                                                    : 'bg-red-100 text-red-800 dark:bg-red-500/10 dark:text-red-400 border-red-200 dark:border-red-500/20'
                                            }`}
                                        >
                                            {tx.status}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-slate-600 dark:text-text-secondary font-mono text-xs">
                                        {tx.timestamp}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <span className="font-mono text-xs font-bold text-slate-700 dark:text-white bg-slate-100 dark:bg-border-dark px-2 py-1 rounded">
                                            {tx.method}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-slate-700 dark:text-white font-medium">
                                        {tx.model}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-slate-600 dark:text-text-secondary font-mono">
                                        {formatTokens(tx.tokens)}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-slate-600 dark:text-text-secondary font-mono">
                                        ${(tx.cost_micros / 1000000).toFixed(3)}
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
