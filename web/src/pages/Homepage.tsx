import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { useSiteName } from '../utils/siteName';

const techStack = ['GPT-5.2', 'Claude 4.5', 'Gemini 3', 'Qwen 3', 'GLM 4.7'];

export function Homepage() {
    const { t } = useTranslation();
    const siteName = useSiteName();
    const features = [
        {
            key: 'latency',
            icon: 'bolt',
            title: t('Ultra-Low Latency'),
            description: t(
                'Optimized routing algorithms ensure your requests hit the fastest available nodes globally, reducing TTFT by up to 40%.'
            ),
        },
        {
            key: 'security',
            icon: 'security',
            title: t('Enterprise Security'),
            description: t(
                'SOC2 compliant infrastructure with end-to-end encryption. Your prompts and completions are never logged or stored.'
            ),
        },
        {
            key: 'unified',
            icon: 'api',
            title: t('Unified Interface'),
            description: t(
                'Switch models instantly without changing a single line of code. One standard API format for all major LLM providers.'
            ),
        },
    ];

    return (
        <div className="bg-background-light dark:bg-background-dark min-h-screen text-slate-900 dark:text-white font-display overflow-x-hidden selection:bg-primary selection:text-white">
            <div className="relative flex flex-col min-h-screen w-full">
                {/* Top Navigation */}
                <nav className="fixed top-0 left-0 right-0 z-50 bg-background-dark/85 backdrop-blur-md border-b border-white/5">
                    <div className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8">
                        <div className="flex items-center justify-between h-20">
                            {/* Brand */}
                            <div className="flex items-center gap-3">
                                <div className="size-8 flex items-center justify-center rounded-lg bg-linear-to-br from-primary to-blue-600 text-white shadow-lg shadow-primary/20">
                                    <Icon name="hub" size={20} />
                                </div>
                                <h1 className="text-white text-lg font-bold tracking-tight">
                                    {siteName}
                                </h1>
                            </div>

                            {/* Desktop Menu */}
                            <div className="hidden md:flex flex-1 justify-end gap-8 items-center">
                                <div className="flex items-center gap-8">
                                    <a
                                        className="text-slate-300 hover:text-white text-sm font-medium transition-colors"
                                        href="#"
                                    >
                                        {t('Solutions')}
                                    </a>
                                    <a
                                        className="text-slate-300 hover:text-white text-sm font-medium transition-colors"
                                        href="#"
                                    >
                                        {t('Documentation')}
                                    </a>
                                    <a
                                        className="text-slate-300 hover:text-white text-sm font-medium transition-colors"
                                        href="#"
                                    >
                                        {t('Pricing')}
                                    </a>
                                </div>
                                <div className="h-6 w-px bg-white/10 mx-2" />
                                <div className="flex gap-3">
                                    <Link
                                        to="/login"
                                        className="flex items-center justify-center rounded-lg h-9 px-4 text-slate-300 hover:text-white text-sm font-medium transition-colors"
                                    >
                                        {t('Login')}
                                    </Link>
                                    <Link
                                        to="/register"
                                        className="flex items-center justify-center rounded-lg h-9 px-4 bg-primary hover:bg-blue-600 text-white text-sm font-bold shadow-lg shadow-primary/25 transition-all transform hover:scale-105"
                                    >
                                        {t('Get Started')}
                                    </Link>
                                    <LanguageSwitcher variant="dark" />
                                </div>
                            </div>

                            {/* Mobile Menu Button */}
                            <div className="md:hidden flex items-center gap-2">
                                <LanguageSwitcher variant="dark" size="sm" />
                                <button className="text-slate-300 hover:text-white p-2">
                                    <Icon name="menu" />
                                </button>
                            </div>
                        </div>
                    </div>
                </nav>

                {/* Main Content */}
                <main className="grow flex flex-col pt-20">
                    {/* Hero Section */}
                    <section className="relative grow flex flex-col items-center justify-center py-20 lg:py-32 px-4 overflow-hidden">
                        {/* Background Decoration */}
                        <div className="absolute inset-0 z-0 pointer-events-none">
                            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-[800px] bg-[radial-gradient(circle_at_50%_0%,rgba(19,91,236,0.15)_0%,rgba(16,22,34,0)_70%)] opacity-60" />
                            <div
                                className="absolute inset-0 bg-cover bg-center opacity-[0.07] mix-blend-screen"
                                style={{
                                    backgroundImage:
                                        "url('https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=2072&auto=format&fit=crop')",
                                }}
                            />
                        </div>

                        <div className="relative z-10 container mx-auto max-w-5xl flex flex-col items-center text-center gap-8">
                            {/* Status Badge */}
                            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 backdrop-blur-xs">
                                <span className="relative flex h-2 w-2">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                            </span>
                            <span className="text-xs font-medium text-emerald-400 tracking-wide uppercase">
                                    {t('System Operational')}
                            </span>
                        </div>

                            {/* Headlines */}
                            <div className="space-y-6">
                                <h1 className="text-5xl md:text-7xl font-black text-white tracking-tight leading-[1.1] drop-shadow-2xl">
                                    {t('The Backbone of')} <br className="hidden md:block" />
                                    <span className="text-transparent bg-clip-text bg-linear-to-r from-blue-300 via-white to-blue-300">
                                        {t('AI Infrastructure')}
                                    </span>
                                </h1>
                                <p className="text-lg md:text-xl text-slate-400 max-w-2xl mx-auto leading-relaxed">
                                    {t(
                                        "Enterprise-grade Large Model API relay. Unify your AI stack with high-speed, stable access to the world's leading LLMs through a single, powerful proxy interface."
                                    )}
                                </p>
                            </div>

                            {/* CTAs */}
                            <div className="flex flex-col sm:flex-row gap-4 mt-4 w-full justify-center">
                                <Link
                                    to="/register"
                                    className="group relative flex items-center justify-center h-14 px-8 rounded-lg bg-primary hover:bg-blue-600 text-white text-base font-bold tracking-wide transition-all shadow-[0_0_20px_rgba(19,91,236,0.3)] hover:shadow-[0_0_30px_rgba(19,91,236,0.5)] overflow-hidden"
                                >
                                    <span className="mr-2">{t('Start Integration')}</span>
                                    <Icon
                                        name="arrow_forward"
                                        size={16}
                                        className="group-hover:translate-x-1 transition-transform"
                                    />
                                </Link>
                                <button className="flex items-center justify-center h-14 px-8 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white text-base font-bold tracking-wide transition-colors backdrop-blur-xs">
                                    <Icon
                                        name="description"
                                        className="mr-2 text-slate-400"
                                    />
                                    {t('View Documentation')}
                                </button>
                            </div>

                            {/* Tech Stack Pills */}
                            <div className="mt-12 pt-8 border-t border-white/5 w-full flex flex-col items-center gap-4">
                                <p className="text-sm font-semibold text-slate-500 uppercase tracking-widest">
                                    {t('Powering Next-Gen Applications')}
                                </p>
                                <div className="flex flex-wrap justify-center gap-3 opacity-60">
                                    {techStack.map((tech) => (
                                        <span
                                            key={tech}
                                            className="px-3 py-1 rounded border border-white/10 bg-white/5 text-xs text-slate-300 font-mono"
                                        >
                                            {tech}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </section>

                    {/* Value Prop Grid */}
                    <section className="py-24 bg-background-dark relative">
                        <div className="max-w-7xl mx-auto px-6">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                                {features.map((feature) => (
                                    <div
                                        key={feature.key}
                                        className="group p-6 rounded-2xl bg-surface-dark border border-white/5 hover:border-primary/50 hover:bg-white/[0.03] transition-all duration-300"
                                    >
                                        <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center text-primary mb-6 group-hover:scale-110 transition-transform">
                                            <Icon name={feature.icon} size={28} />
                                        </div>
                                        <h3 className="text-xl font-bold text-white mb-3">
                                            {feature.title}
                                        </h3>
                                        <p className="text-slate-400 leading-relaxed">
                                            {feature.description}
                                        </p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </section>
                </main>

                {/* Footer */}
                <footer className="bg-[#0b0f17] border-t border-white/5 py-12">
                    <div className="max-w-7xl mx-auto px-6">
                        <div className="flex flex-col md:flex-row justify-between items-center gap-6">
                            <div className="flex items-center gap-2">
                                <Icon name="hub" className="text-primary text-2xl" />
                                <span className="text-slate-300 font-semibold">
                                    {siteName}
                                </span>
                            </div>
                            <div className="flex flex-wrap justify-center gap-8">
                                <a
                                    className="text-slate-500 hover:text-white transition-colors text-sm"
                                    href="#"
                                >
                                    {t('Privacy Policy')}
                                </a>
                                <a
                                    className="text-slate-500 hover:text-white transition-colors text-sm"
                                    href="#"
                                >
                                    {t('Terms of Service')}
                                </a>
                                <a
                                    className="text-slate-500 hover:text-white transition-colors text-sm"
                                    href="#"
                                >
                                    {t('API Status')}
                                </a>
                                <a
                                    className="text-slate-500 hover:text-white transition-colors text-sm"
                                    href="#"
                                >
                                    {t('Contact Support')}
                                </a>
                            </div>
                            <p className="text-slate-600 text-sm">
                                {t('\u00a9 2026 Router-For.ME, All rights reserved.')}
                            </p>
                        </div>
                    </div>
                </footer>
            </div>
        </div>
    );
}
