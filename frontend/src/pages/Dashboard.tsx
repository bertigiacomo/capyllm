import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  getAdminStats,
  getUpstreamKeys,
  createUpstreamKey,
  updateUpstreamKey,
  deleteUpstreamKey,
  resetKeyCooldown,
  resetUpstreamKeyTokens,
  testUpstreamKey,
  discoverUpstreamModels,
  getProviderPresets,
  getDiscoveredModels,
  getPools,
  createPool,
  updatePool,
  setPoolRoutes,
  resetRouteSpend,
  deletePool,
  getCapyKeys,
  createCapyKey,
  updateCapyKey,
  deleteCapyKey,
  resetCapyKeySpend,
  getLogs,
  getPricingRules,
  createPricingRule,
  updatePricingRule,
  deletePricingRule,
  type PricingRule,
  getModelsCatalog,
  syncModelsDev,
  getTelegramSettings,
  saveTelegramSettings,
  testTelegramWebhook,
  type TelegramConfig,
  getSystemInfo,
  clearLogs,
  type SystemInfo,
  getSystemSettings,
  updateSystemSettings,
  type SystemSettings,
  type DashboardStats,
  getModelStats,
  getProviderStats,
  type ModelDetailStats,
  logout,
  type UserSession,
} from '../api';
import { toggleDarkMode, isDarkMode } from '../theme';
import { CapyLogo } from '../components/CapyLogo';
import { BudgetLimitControl } from '../components/BudgetLimitControl';
import { useI18n } from '../i18n';
import { Docs } from './Docs';
import {
  Key,
  Cpu,
  Server,
  Coins,
  Activity,
  Settings,
  Info,
  BookOpen,
  Sun,
  Moon,
  LogOut,
  Check,
  Copy,
  RefreshCw,
  Trash2,
  Pencil,
  ArrowRight,
  Shield,
  Download,
  AlertTriangle,
  HelpCircle,
  Zap,
  Plus,
  X,
  Bell,
  Clock,
  Database,
  Lock,
  DollarSign,
  BarChart3,
  Layers,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Sliders,
  ArrowUp,
  ArrowDown,
  Search,
  Menu,
} from 'lucide-react';

interface DashboardProps {
  user: UserSession;
  onLogout: () => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ user, onLogout }) => {
  const { t, lang, setLang } = useI18n();
  const [dark, setDark] = useState(isDarkMode());
  const [currentView, setCurrentView] = useState<'dashboard' | 'docs'>('dashboard');
  const [activeTab, setActiveTab] = useState<'analytics' | 'capykeys' | 'pools' | 'providers' | 'pricing' | 'logs'>('analytics');

  // Stats
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [selectedModelForStats, setSelectedModelForStats] = useState<string | null>(null);
  const [modelDetailStats, setModelDetailStats] = useState<ModelDetailStats | null>(null);
  const [loadingModelStats, setLoadingModelStats] = useState(false);
  const [hoveredHourIndex, setHoveredHourIndex] = useState<number | null>(null);

  // Model Details Sheet (models.dev metadata & technical specification)
  const [selectedModelForDetails, setSelectedModelForDetails] = useState<any | null>(null);
  const [showRawJson, setShowRawJson] = useState(false);
  const [copiedRawJson, setCopiedRawJson] = useState(false);

  const handleOpenModelStats = async (modelName: string) => {
    setSelectedModelForStats(modelName);
    setLoadingModelStats(true);
    try {
      const data = await getModelStats(modelName);
      setModelDetailStats(data);
    } catch (err: any) {
      console.error('Failed to load model stats', err);
    } finally {
      setLoadingModelStats(false);
    }
  };

  // Upstream Keys (Fornitori)
  const [keys, setKeys] = useState<any[]>([]);
  const [showAddKeyModal, setShowAddKeyModal] = useState(false);
  const [editingKeyId, setEditingKeyId] = useState<string | null>(null);
  const [showAdvancedKeyOptions, setShowAdvancedKeyOptions] = useState(false);
  const [keyModalError, setKeyModalError] = useState<string | null>(null);
  const [keyModalSubmitting, setKeyModalSubmitting] = useState(false);
  const [providerPresets, setProviderPresets] = useState<any[]>([]);
  const [allProviders, setAllProviders] = useState<any[]>([]);
  const [providerSearchTerm, setProviderSearchTerm] = useState('');
  const [isProviderDropdownOpen, setIsProviderDropdownOpen] = useState(false);
  const [selectedProviderForStats, setSelectedProviderForStats] = useState<string | null>(null);
  const [providerStatsDetail, setProviderStatsDetail] = useState<any | null>(null);
  const [loadingProviderStats, setLoadingProviderStats] = useState(false);
  const [newKey, setNewKey] = useState({
    provider: 'openai',
    name: '',
    base_url: 'https://api.openai.com/v1',
    api_key: '',
    pool_id: '',
    is_free_tier: false,
    daily_token_limit: 0,
    budget_type: 'tokens' as 'tokens' | 'usd',
    budget_cadence: 'daily' as 'daily' | 'weekly' | 'monthly' | 'one-shot',
    budget_limit: 0,
    api_schema: 'chat_completions' as 'chat_completions' | 'responses' | 'decision' | 'custom',
    supported_schemas: ['chat_completions', 'responses', 'embeddings', 'decision'] as string[],
    custom_schema_config: '',
  });
  const [keyActionNotice, setKeyActionNotice] = useState<{ id: string; msg: string; ok: boolean } | null>(null);
  const [syncingKeyId, setSyncingKeyId] = useState<string | null>(null);
  const [expandedModelsKeyId, setExpandedModelsKeyId] = useState<string | null>(null);

  // Pools
  const [pools, setPools] = useState<any[]>([]);
  const [showAddPoolModal, setShowAddPoolModal] = useState(false);
  const [editingPoolId, setEditingPoolId] = useState<string | null>(null);
  const [poolModalError, setPoolModalError] = useState<string | null>(null);
  const [newPool, setNewPool] = useState({
    id: '',
    name: '',
    description: '',
    budget_type: 'tokens' as 'tokens' | 'usd',
    budget_cadence: 'daily' as 'daily' | 'weekly' | 'monthly' | 'one-shot',
    budget_limit: 0,
    allow_cross_model_fallback: 0,
    reasoning_policy: 'inherit',
  });

  // Attach key to Pool modal
  const [targetPoolForRoute, setTargetPoolForRoute] = useState<any | null>(null);
  const [editingRouteIndex, setEditingRouteIndex] = useState<number | null>(null);
  const [routeModalError, setRouteModalError] = useState<string | null>(null);
  const [newRouteKeyId, setNewRouteKeyId] = useState('');
  const [newRoutePattern, setNewRoutePattern] = useState('*');
  const [newRouteTokenLimit, setNewRouteTokenLimit] = useState(0);
  const [newRouteReasoningEffort, setNewRouteReasoningEffort] = useState<string>('inherit');

  // CapyKeys (Le tue app)
  const [capyKeys, setCapyKeys] = useState<any[]>([]);
  const [allDiscoveredModels, setAllDiscoveredModels] = useState<string[]>([]);
  const [showAddCapyKeyModal, setShowAddCapyKeyModal] = useState(false);
  const [editingCapyKeyId, setEditingCapyKeyId] = useState<string | null>(null);
  const [showAdvancedCapyKeyOptions, setShowAdvancedCapyKeyOptions] = useState(false);
  const [capyKeyModalError, setCapyKeyModalError] = useState<string | null>(null);
  const [newCapyKey, setNewCapyKey] = useState({
    name: '',
    pool_id: '',
    rate_limit_rpm: 0,
    budget_type: 'tokens' as 'usd' | 'tokens',
    budget_cadence: 'daily' as 'daily' | 'weekly' | 'monthly' | 'one-shot',
    budget_limit: 0,
    allowed_pools: '',
    allowed_models: '',
    include_metadata: true,
  });
  const [selectedPoolPills, setSelectedPoolPills] = useState<string[]>(['*']);
  const [selectedModelPills, setSelectedModelPills] = useState<string[]>(['*']);
  const [createdCapyKeySecret, setCreatedCapyKeySecret] = useState<string | null>(null);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [customCapyKeyModelInput, setCustomCapyKeyModelInput] = useState('');

  const getModelsForPool = (poolId?: string | null): string[] => {
    if (!poolId) return [];
    const pool = pools.find((p) => p.id === poolId);
    if (!pool) return [];
    const modelsSet = new Set<string>();
    const routes: any[] = pool.routes || [];
    for (const r of routes) {
      const k = keys.find((key) => key.id === r.upstream_key_id);
      const pattern = r.model_pattern ? r.model_pattern.trim() : '*';
      if (pattern === '*') {
        if (k?.discovered_models && Array.isArray(k.discovered_models)) {
          k.discovered_models.forEach((m: string) => modelsSet.add(m));
        }
      } else {
        const parts = pattern.split(',').map((s: string) => s.trim()).filter(Boolean);
        for (const p of parts) {
          if (p === '*') {
            if (k?.discovered_models && Array.isArray(k.discovered_models)) {
              k.discovered_models.forEach((m: string) => modelsSet.add(m));
            }
          } else {
            modelsSet.add(p);
          }
        }
      }
    }
    if (routes.length === 0) {
      const directKeys = keys.filter((k) => k.pool_id === poolId);
      for (const k of directKeys) {
        if (k.discovered_models && Array.isArray(k.discovered_models)) {
          k.discovered_models.forEach((m: string) => modelsSet.add(m));
        }
      }
    }
    return Array.from(modelsSet);
  };

  // Models Catalog & Pricing
  const [catalog, setCatalog] = useState<any[]>([]);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [catalogTestingState, setCatalogTestingState] = useState<{ [keyId: string]: { loading: boolean; msg: string; ok: boolean } }>({});
  const [syncingModelsDev, setSyncingModelsDev] = useState(false);
  const [pricingRules, setPricingRules] = useState<PricingRule[]>([]);
  const [showAddPricingModal, setShowAddPricingModal] = useState(false);
  const [editingPricingId, setEditingPricingId] = useState<string | null>(null);
  const [pricingModalError, setPricingModalError] = useState<string | null>(null);
  const [pricingFilter, setPricingFilter] = useState({ model: '', provider: '' });
  const [newPricingRule, setNewPricingRule] = useState({
    model: '',
    provider: '',
    upstream_key_id: '',
    capy_key_id: '',
    prompt_price_per_1m: 0,
    completion_price_per_1m: 0,
  });

  // Settings Modal
  const [telegramConfig, setTelegramConfig] = useState<TelegramConfig | null>(null);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'telegram' | 'reset' | 'security' | 'database'>('telegram');
  const [systemSettings, setSystemSettings] = useState<SystemSettings | null>(null);
  const [selectedResetHour, setSelectedResetHour] = useState<number>(0);
  const [savingResetHour, setSavingResetHour] = useState(false);
  const [resetHourNotice, setResetHourNotice] = useState<{ msg: string; ok: boolean } | null>(null);
  const [telegramForm, setTelegramForm] = useState({
    is_enabled: false,
    bot_token: '',
    chat_id: '',
    notify_on_budget_warning: true,
    notify_on_budget_exceeded: true,
    notify_on_key_cooldown: true,
    notify_on_key_error: true,
  });
  const [telegramTesting, setTelegramTesting] = useState(false);
  const [telegramTestNotice, setTelegramTestNotice] = useState<{ msg: string; ok: boolean } | null>(null);

  // System & Info
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [showAboutModal, setShowAboutModal] = useState(false);
  const [showMenuDropdown, setShowMenuDropdown] = useState(false);
  const [clearingLogs, setClearingLogs] = useState(false);

  // Logs
  const [logs, setLogs] = useState<any[]>([]);
  const [selectedLogForDetail, setSelectedLogForDetail] = useState<any | null>(null);
  const [copiedLogJson, setCopiedLogJson] = useState(false);
  const [hidePoolRoutingBanner, setHidePoolRoutingBanner] = useState<boolean>(() => {
    try {
      return localStorage.getItem('capy_pool_routing_dismissed') === '1';
    } catch {
      return false;
    }
  });
  const [autoRefreshLogs, setAutoRefreshLogs] = useState(false);
  const [logFilter, setLogFilter] = useState({ model: '', provider: '' });

  // Notifications
  const [toastNotice, setToastNotice] = useState<{ msg: string; ok: boolean } | null>(null);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);

  const showToast = (msg: string, ok = true) => {
    setToastNotice({ msg, ok });
    setTimeout(() => setToastNotice(null), 4000);
  };

  const loadData = useCallback(async () => {
    try {
      const [s, k, p, vk, l, presetsRes, discModelsRes, prRes, tgRes, catRes] = await Promise.all([
        getAdminStats(),
        getUpstreamKeys(),
        getPools(),
        getCapyKeys(),
        getLogs(50, 0, logFilter.model || undefined, logFilter.provider || undefined),
        getProviderPresets().catch(() => ({ presets: [] })),
        getDiscoveredModels().catch(() => ({ models: [] })),
        getPricingRules().catch(() => ({ rules: [] })),
        getTelegramSettings().catch(() => null),
        getModelsCatalog().catch(() => ({ catalog: [] })),
      ]);
      setStats(s);
      setKeys(k.keys || []);
      setPools(p.pools || []);
      setCapyKeys(vk.virtual_keys || []);
      setLogs(l.logs || []);
      setCatalog(catRes?.catalog || []);
      if (presetsRes?.presets) setProviderPresets(presetsRes.presets);
      if (presetsRes?.all_providers) setAllProviders(presetsRes.all_providers);
      if (discModelsRes?.models) setAllDiscoveredModels(discModelsRes.models);
      if (prRes?.rules) setPricingRules(prRes.rules);
      if (tgRes) {
        setTelegramConfig(tgRes);
        setTelegramForm((prev) => ({
          ...prev,
          is_enabled: tgRes.is_enabled,
          chat_id: tgRes.chat_id || '',
          notify_on_budget_warning: tgRes.notify_on_budget_warning,
          notify_on_budget_exceeded: tgRes.notify_on_budget_exceeded,
          notify_on_key_cooldown: tgRes.notify_on_key_cooldown,
          notify_on_key_error: tgRes.notify_on_key_error,
        }));
      }
    } catch (err: any) {
      setErrorNotice(err.message || 'Errore nel caricamento dei dati');
    }
  }, [logFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Polling for logs if auto-refresh enabled
  useEffect(() => {
    if (!autoRefreshLogs) return;
    const interval = setInterval(() => {
      getLogs(50, 0, logFilter.model || undefined, logFilter.provider || undefined)
        .then((l) => setLogs(l.logs || []))
        .catch(() => {});
      getAdminStats().then(setStats).catch(() => {});
    }, 3000);
    return () => clearInterval(interval);
  }, [autoRefreshLogs, logFilter]);

  // Load detailed provider stats when selected
  useEffect(() => {
    if (!selectedProviderForStats) {
      setProviderStatsDetail(null);
      return;
    }
    setLoadingProviderStats(true);
    getProviderStats(selectedProviderForStats)
      .then((data) => setProviderStatsDetail(data))
      .catch((err) => console.error('Failed to load provider stats:', err))
      .finally(() => setLoadingProviderStats(false));
  }, [selectedProviderForStats]);

  // Global Escape key listener to close top modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selectedModelForDetails) setSelectedModelForDetails(null);
        else if (selectedModelForStats) setSelectedModelForStats(null);
        else if (showAddPricingModal) setShowAddPricingModal(false);
        else if (targetPoolForRoute) setTargetPoolForRoute(null);
        else if (showAddPoolModal) setShowAddPoolModal(false);
        else if (createdCapyKeySecret) setCreatedCapyKeySecret(null);
        else if (showAddCapyKeyModal) setShowAddCapyKeyModal(false);
        else if (showAddKeyModal) setShowAddKeyModal(false);
        else if (showSettingsModal) setShowSettingsModal(false);
        else if (showAboutModal) setShowAboutModal(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    selectedModelForStats,
    showAddPricingModal,
    targetPoolForRoute,
    showAddPoolModal,
    createdCapyKeySecret,
    showAddCapyKeyModal,
    showAddKeyModal,
    showSettingsModal,
    showAboutModal,
  ]);

  const handleToggleTheme = () => {
    const isNowDark = toggleDarkMode();
    setDark(isNowDark);
  };

  const handleLogoutClick = async () => {
    await logout();
    onLogout();
  };

  const handleOpenSettings = async (tab: 'telegram' | 'reset' | 'security' | 'database' = 'telegram') => {
    setSettingsTab(tab);
    setShowSettingsModal(true);
    setResetHourNotice(null);
    try {
      const info = await getSystemInfo();
      setSystemInfo(info);
      await loadSystemSettings();
    } catch {}
  };

  const handleProviderSelect = (providerId: string) => {
    const preset = providerPresets.find((p) => p.id === providerId) || allProviders.find((p) => p.id === providerId);
    let url = preset?.baseUrl || preset?.base_url || 'https://api.openai.com/v1';
    let suggestedName = preset ? preset.name : '';

    if (!preset) {
      if (providerId === 'openai') url = 'https://api.openai.com/v1';
      else if (providerId === 'gemini') url = 'https://generativelanguage.googleapis.com/v1beta/openai/';
      else if (providerId === 'groq') url = 'https://api.groq.com/openai/v1';
      else if (providerId === 'mistral') url = 'https://api.mistral.ai/v1';
      else if (providerId === 'deepseek') url = 'https://api.deepseek.com';
      else if (providerId === 'openrouter') url = 'https://openrouter.ai/api/v1';
      else if (providerId === 'together') url = 'https://api.together.xyz/v1';
      else if (providerId === 'ollama') url = 'http://localhost:11434/v1';
      else if (providerId === 'jev') url = 'https://api.typesafe.ai/v1';
      else if (providerId === 'custom') url = 'http://localhost:8000/v1';
    }

    setNewKey({
      ...newKey,
      provider: providerId,
      base_url: url,
      name: newKey.name || suggestedName,
      supported_schemas: providerId === 'openrouter' || providerId === 'openai'
        ? ['chat_completions', 'responses', 'embeddings', 'decision']
        : providerId === 'jev'
        ? ['decision']
        : newKey.supported_schemas,
    });
  };

  const toggleKeySchema = (schemaType: string) => {
    if (schemaType === '*') {
      if (newKey.supported_schemas.includes('*')) {
        setNewKey({ ...newKey, supported_schemas: ['chat_completions'] });
      } else {
        setNewKey({ ...newKey, supported_schemas: ['*'] });
      }
      return;
    }
    const current = newKey.supported_schemas.filter((s) => s !== '*');
    if (current.includes(schemaType)) {
      const next = current.filter((s) => s !== schemaType);
      setNewKey({
        ...newKey,
        supported_schemas: next.length > 0 ? next : ['chat_completions'],
        api_schema: (next[0] || 'chat_completions') as any,
      });
    } else {
      const next = [...current, schemaType];
      setNewKey({
        ...newKey,
        supported_schemas: next,
        api_schema: (next[0] || 'chat_completions') as any,
      });
    }
  };

  const handleOpenAddKey = () => {
    setEditingKeyId(null);
    setKeyModalError(null);
    setShowAdvancedKeyOptions(false);
    setProviderSearchTerm('');
    setIsProviderDropdownOpen(false);
    setNewKey({
      provider: 'openai',
      name: '',
      base_url: 'https://api.openai.com/v1',
      api_key: '',
      pool_id: '',
      is_free_tier: false,
      daily_token_limit: 0,
      budget_type: 'tokens',
      budget_cadence: 'daily',
      budget_limit: 0,
      api_schema: 'chat_completions',
      supported_schemas: ['chat_completions', 'responses', 'embeddings', 'decision'],
      custom_schema_config: '',
    });
    setShowAddKeyModal(true);
  };

  const handleOpenEditKey = (k: any) => {
    setEditingKeyId(k.id);
    setKeyModalError(null);
    setShowAdvancedKeyOptions(true);
    setProviderSearchTerm(k.provider || '');
    setIsProviderDropdownOpen(false);
    let parsedSchemas = ['chat_completions'];
    if (k.supported_schemas) {
      try {
        const s = JSON.parse(k.supported_schemas);
        if (Array.isArray(s) && s.length > 0) parsedSchemas = s;
      } catch {}
    } else if (k.api_schema) {
      parsedSchemas = [k.api_schema];
    }
    setNewKey({
      provider: k.provider || 'openai',
      name: k.name || '',
      base_url: k.base_url || '',
      api_key: '',
      pool_id: k.pool_id || '',
      is_free_tier: Boolean(k.is_free_tier),
      daily_token_limit: k.daily_token_limit || 0,
      budget_type: k.budget_type || 'tokens',
      budget_cadence: k.budget_cadence || 'daily',
      budget_limit: k.budget_limit !== undefined ? k.budget_limit : (k.daily_token_limit || 0),
      api_schema: k.api_schema || 'chat_completions',
      supported_schemas: parsedSchemas,
      custom_schema_config: k.custom_schema_config || '',
    });
    setShowAddKeyModal(true);
  };

  const filteredProviders = useMemo(() => {
    const query = providerSearchTerm.trim().toLowerCase();
    const list = allProviders.length > 0 ? allProviders : providerPresets;
    if (!query) return list.slice(0, 40);
    return list.filter((p: any) =>
      (p.name && p.name.toLowerCase().includes(query)) ||
      (p.id && p.id.toLowerCase().includes(query))
    ).slice(0, 40);
  }, [allProviders, providerPresets, providerSearchTerm]);

  const handleCreateUpstreamKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setKeyModalError(null);
    setKeyModalSubmitting(true);
    try {
      if (editingKeyId) {
        const payload: any = {
          provider: newKey.provider,
          name: newKey.name.trim(),
          base_url: newKey.base_url.trim(),
          is_free_tier: newKey.is_free_tier,
          budget_type: newKey.budget_type,
          budget_cadence: newKey.budget_cadence,
          budget_limit: Number(newKey.budget_limit) || 0,
          daily_token_limit: newKey.budget_type === 'tokens' ? Math.floor(Number(newKey.budget_limit) || 0) : 0,
          api_schema: newKey.api_schema,
          supported_schemas: newKey.supported_schemas,
          custom_schema_config: newKey.custom_schema_config.trim() || undefined,
        };
        if (newKey.api_key.trim()) {
          payload.api_key = newKey.api_key.trim();
        }
        await updateUpstreamKey(editingKeyId, payload);
        setShowAddKeyModal(false);
        setEditingKeyId(null);
        await loadData();
        showToast(t('toast.provider_updated'));
      } else {
        const res = await createUpstreamKey({
          provider: newKey.provider,
          name: newKey.name,
          base_url: newKey.base_url,
          api_key: newKey.api_key,
          pool_id: newKey.pool_id || undefined,
          is_free_tier: newKey.is_free_tier,
          budget_type: newKey.budget_type,
          budget_cadence: newKey.budget_cadence,
          budget_limit: Number(newKey.budget_limit) || 0,
          daily_token_limit: newKey.budget_type === 'tokens' ? Math.floor(Number(newKey.budget_limit) || 0) : 0,
          api_schema: newKey.api_schema,
          supported_schemas: newKey.supported_schemas,
          custom_schema_config: newKey.custom_schema_config.trim() || undefined,
        });
        setShowAddKeyModal(false);
        setShowAdvancedKeyOptions(false);
        setNewKey({
          provider: 'openai',
          name: '',
          base_url: 'https://api.openai.com/v1',
          api_key: '',
          pool_id: '',
          is_free_tier: false,
          daily_token_limit: 0,
          budget_type: 'tokens',
          budget_cadence: 'daily',
          budget_limit: 0,
          api_schema: 'chat_completions',
          supported_schemas: ['chat_completions', 'responses', 'embeddings', 'decision'],
          custom_schema_config: '',
        });
        await loadData();

        if (res.discovery?.verified) {
          showToast(t('toast.provider_connected_discovery', { count: res.discovery.models_count, ms: res.discovery.latency_ms }));
        } else {
          showToast(t('toast.provider_saved'));
        }
      }
    } catch (err: any) {
      setKeyModalError(err.message || t('common.error'));
    } finally {
      setKeyModalSubmitting(false);
    }
  };

  const handleDeleteUpstreamKey = async (id: string) => {
    if (!confirm(t('providers.delete_confirm'))) return;
    try {
      await deleteUpstreamKey(id);
      await loadData();
      showToast(t('toast.provider_deleted'));
    } catch (err: any) {
      showToast(err.message || t('toast.provider_delete_error'), false);
    }
  };

  const handleResetCooldown = async (id: string) => {
    try {
      await resetKeyCooldown(id);
      await loadData();
      showToast(t('toast.cooldown_reset'));
    } catch (err: any) {
      showToast(err.message || t('common.error'), false);
    }
  };

  const handleResetUpstreamDailyTokens = async (id: string) => {
    try {
      await resetUpstreamKeyTokens(id);
      await loadData();
      showToast(t('toast.tokens_reset'));
    } catch (err: any) {
      showToast(err.message || t('common.error'), false);
    }
  };

  const handleTestKey = async (id: string) => {
    setKeyActionNotice({ id, msg: 'Test...', ok: true });
    try {
      const res = await testUpstreamKey(id);
      setKeyActionNotice({
        id,
        msg: res.success ? `OK (${res.latency_ms}ms)` : (res.error || res.message),
        ok: res.success,
      });
      await loadData();
    } catch (err: any) {
      setKeyActionNotice({ id, msg: err.message, ok: false });
    }
  };

  const handleSyncModels = async (id: string) => {
    setSyncingKeyId(id);
    try {
      const res = await discoverUpstreamModels(id);
      if (res.success) {
        showToast(t('toast.models_synced', { count: res.models?.length || 0, ms: res.latency_ms }));
      } else {
        showToast(res.error || t('toast.models_sync_error'), false);
      }
      await loadData();
    } catch (err: any) {
      showToast(err.message || t('toast.models_sync_error'), false);
    } finally {
      setSyncingKeyId(null);
    }
  };

  const handleOpenAddPool = () => {
    setEditingPoolId(null);
    setPoolModalError(null);
    setNewPool({
      id: '',
      name: '',
      description: '',
      budget_type: 'tokens',
      budget_cadence: 'daily',
      budget_limit: 0,
      allow_cross_model_fallback: 0,
      reasoning_policy: 'inherit',
    });
    setShowAddPoolModal(true);
  };

  const handleOpenEditPool = (pool: any) => {
    setEditingPoolId(pool.id);
    setPoolModalError(null);
    setNewPool({
      id: pool.id,
      name: pool.name || '',
      description: pool.description || '',
      budget_type: pool.budget_type || 'tokens',
      budget_cadence: pool.budget_cadence || 'daily',
      budget_limit: pool.budget_limit || 0,
      allow_cross_model_fallback: pool.allow_cross_model_fallback || 0,
      reasoning_policy: pool.reasoning_policy || 'inherit',
    });
    setShowAddPoolModal(true);
  };

  const handleCreatePool = async (e: React.FormEvent) => {
    e.preventDefault();
    setPoolModalError(null);
    try {
      if (editingPoolId) {
        await updatePool(editingPoolId, {
          name: newPool.name.trim(),
          description: newPool.description.trim() || undefined,
          budget_type: newPool.budget_type,
          budget_cadence: newPool.budget_cadence,
          budget_limit: Number(newPool.budget_limit) || 0,
          allow_cross_model_fallback: newPool.allow_cross_model_fallback || 0,
          reasoning_policy: newPool.reasoning_policy || 'inherit',
        });
        showToast(t('toast.pool_updated'));
      } else {
        await createPool({
          id: newPool.id.trim(),
          name: newPool.name.trim(),
          description: newPool.description.trim() || undefined,
          budget_type: newPool.budget_type,
          budget_cadence: newPool.budget_cadence,
          budget_limit: Number(newPool.budget_limit) || 0,
          allow_cross_model_fallback: newPool.allow_cross_model_fallback || 0,
          reasoning_policy: newPool.reasoning_policy || 'inherit',
        });
        showToast(t('toast.pool_created'));
      }
      setShowAddPoolModal(false);
      setEditingPoolId(null);
      setNewPool({
        id: '',
        name: '',
        description: '',
        budget_type: 'tokens',
        budget_cadence: 'daily',
        budget_limit: 0,
        allow_cross_model_fallback: 0,
        reasoning_policy: 'inherit',
      });
      await loadData();
    } catch (err: any) {
      setPoolModalError(err.message || (editingPoolId ? 'Errore modifica pool' : 'Errore nella creazione del pool'));
    }
  };

  const handleToggleResilience = async (pool: any) => {
    const nextVal = pool.allow_cross_model_fallback === 1 ? 0 : 1;
    try {
      await updatePool(pool.id, { allow_cross_model_fallback: nextVal });
      setPools((prev) =>
        prev.map((p) => (p.id === pool.id ? { ...p, allow_cross_model_fallback: nextVal } : p))
      );
      showToast(nextVal === 1 ? t('pools.resilience_active') : t('pools.resilience_disabled'));
    } catch (err: any) {
      showToast(err.message || 'Errore aggiornamento pool', false);
    }
  };

  const handleDeletePool = async (id: string) => {
    if (!confirm(t('pools.delete_confirm'))) return;
    try {
      await deletePool(id);
      await loadData();
      showToast(t('toast.pool_deleted'));
    } catch (err: any) {
      showToast(err.message || t('toast.pool_delete_error'), false);
    }
  };

  const handleOpenAddRoute = (pool: any) => {
    setTargetPoolForRoute(pool);
    setEditingRouteIndex(null);
    setRouteModalError(null);
    setNewRouteKeyId(keys[0]?.id || '');
    setNewRoutePattern('*');
    setNewRouteTokenLimit(0);
    setNewRouteReasoningEffort('inherit');
  };

  const handleOpenEditRoute = (pool: any, route: any, index: number) => {
    setTargetPoolForRoute(pool);
    setEditingRouteIndex(index);
    setRouteModalError(null);
    setNewRouteKeyId(route.upstream_key_id);
    setNewRoutePattern(route.model_pattern || '*');
    setNewRouteTokenLimit(route.token_limit || 0);
    setNewRouteReasoningEffort(route.reasoning_effort || 'inherit');
  };

  const handleSaveRoute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetPoolForRoute) return;
    setRouteModalError(null);
    try {
      const currentRoutes: any[] = targetPoolForRoute.routes || [];
      let updatedRoutes: any[];

      const effortVal = newRouteReasoningEffort && newRouteReasoningEffort !== 'inherit'
        ? newRouteReasoningEffort
        : null;

      if (editingRouteIndex !== null) {
        updatedRoutes = currentRoutes.map((r: any, idx: number) => {
          if (idx === editingRouteIndex) {
            return {
              id: r.route_id || r.id,
              upstream_key_id: newRouteKeyId,
              priority: idx,
              model_pattern: newRoutePattern.trim() || '*',
              token_limit: Number(newRouteTokenLimit) || 0,
              cost_limit: r.cost_limit || 0,
              reasoning_effort: effortVal,
            };
          }
          return {
            id: r.route_id || r.id,
            upstream_key_id: r.upstream_key_id,
            priority: idx,
            model_pattern: r.model_pattern || '*',
            token_limit: r.token_limit || 0,
            cost_limit: r.cost_limit || 0,
            reasoning_effort: r.reasoning_effort || null,
          };
        });
      } else {
        const newPriority = currentRoutes.length;
        updatedRoutes = [
          ...currentRoutes.map((r: any, idx: number) => ({
            id: r.route_id || r.id,
            upstream_key_id: r.upstream_key_id,
            priority: idx,
            model_pattern: r.model_pattern || '*',
            token_limit: r.token_limit || 0,
            cost_limit: r.cost_limit || 0,
            reasoning_effort: r.reasoning_effort || null,
          })),
          {
            upstream_key_id: newRouteKeyId,
            priority: newPriority,
            model_pattern: newRoutePattern.trim() || '*',
            token_limit: Number(newRouteTokenLimit) || 0,
            cost_limit: 0,
            reasoning_effort: effortVal,
          },
        ];
      }

      await setPoolRoutes(targetPoolForRoute.id, updatedRoutes);
      setTargetPoolForRoute(null);
      setEditingRouteIndex(null);
      await loadData();
      showToast(editingRouteIndex !== null ? t('toast.route_updated') : t('common.success'));
    } catch (err: any) {
      setRouteModalError(err.message || 'Errore nel salvataggio del percorso');
    }
  };

  const handleMoveRoute = async (pool: any, index: number, direction: 'up' | 'down') => {
    const routes = [...(pool.routes || [])];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= routes.length) return;

    const temp = routes[index];
    routes[index] = routes[targetIndex];
    routes[targetIndex] = temp;

    const updatedRoutes = routes.map((r: any, idx: number) => ({
      id: r.route_id,
      upstream_key_id: r.upstream_key_id,
      priority: idx,
      model_pattern: r.model_pattern || '*',
      token_limit: r.token_limit || 0,
      cost_limit: r.cost_limit || 0,
      reasoning_effort: r.reasoning_effort || null,
    }));

    try {
      await setPoolRoutes(pool.id, updatedRoutes);
      await loadData();
      showToast(`P${targetIndex}: ${routes[targetIndex].upstream_key_name || 'Key'}`);
    } catch (err: any) {
      showToast(err.message || 'Errore nel riordinamento', false);
    }
  };

  const handleRemoveRoute = async (pool: any, index: number) => {
    const routes = (pool.routes || []).filter((_: any, idx: number) => idx !== index);
    const updatedRoutes = routes.map((r: any, idx: number) => ({
      id: r.route_id,
      upstream_key_id: r.upstream_key_id,
      priority: idx,
      model_pattern: r.model_pattern || '*',
      token_limit: r.token_limit || 0,
      cost_limit: r.cost_limit || 0,
    }));

    try {
      await setPoolRoutes(pool.id, updatedRoutes);
      await loadData();
      showToast(t('common.success'));
    } catch (err: any) {
      showToast(err.message || 'Errore nella rimozione', false);
    }
  };

  const handleResetRouteSpend = async (poolId: string, routeId: string) => {
    try {
      await resetRouteSpend(poolId, routeId);
      await loadData();
      showToast(t('common.success'));
    } catch (err: any) {
      showToast(err.message || 'Errore azzeramento rotta', false);
    }
  };

  const handleOpenAddCapyKeyModal = () => {
    setEditingCapyKeyId(null);
    setSelectedPoolPills(['*']);
    setSelectedModelPills(['*']);
    setShowAdvancedCapyKeyOptions(false);
    setCapyKeyModalError(null);
    setNewCapyKey({
      name: '',
      pool_id: pools[0]?.id || '',
      rate_limit_rpm: 0,
      budget_type: 'tokens',
      budget_cadence: 'daily',
      budget_limit: 0,
      allowed_pools: '',
      allowed_models: '',
      include_metadata: true,
    });
    setShowAddCapyKeyModal(true);
  };

  const handleOpenEditCapyKey = (k: any) => {
    setEditingCapyKeyId(k.id);
    setShowAdvancedCapyKeyOptions(true);
    setCapyKeyModalError(null);

    let parsedModels: string[] = ['*'];
    if (k.allowed_models) {
      try {
        const m = JSON.parse(k.allowed_models);
        if (Array.isArray(m) && m.length > 0) parsedModels = m;
      } catch {
        const parts = k.allowed_models.split(',').map((s: string) => s.trim()).filter(Boolean);
        if (parts.length > 0) parsedModels = parts;
      }
    }

    setNewCapyKey({
      name: k.name || '',
      pool_id: k.pool_id || '',
      rate_limit_rpm: k.rate_limit_rpm || 0,
      budget_type: k.budget_type || 'tokens',
      budget_cadence: k.budget_cadence || 'monthly',
      budget_limit: k.budget_limit || 0,
      allowed_pools: '',
      allowed_models: '',
      include_metadata: k.include_metadata !== 0,
    });
    setSelectedModelPills(parsedModels);
    setShowAddCapyKeyModal(true);
  };

  const togglePoolPill = (poolId: string) => {
    if (poolId === '*') {
      setSelectedPoolPills(['*']);
      return;
    }
    let updated = selectedPoolPills.filter((p) => p !== '*');
    if (updated.includes(poolId)) {
      updated = updated.filter((p) => p !== poolId);
      if (updated.length === 0) updated = ['*'];
    } else {
      updated.push(poolId);
    }
    setSelectedPoolPills(updated);
  };

  const toggleModelPill = (modelId: string) => {
    if (modelId === '*') {
      setSelectedModelPills(['*']);
      return;
    }
    let updated = selectedModelPills.filter((m) => m !== '*');
    if (updated.includes(modelId)) {
      updated = updated.filter((m) => m !== modelId);
      if (updated.length === 0) updated = ['*'];
    } else {
      updated.push(modelId);
    }
    setSelectedModelPills(updated);
  };

  const handleCreateCapyKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setCapyKeyModalError(null);
    try {
      let allowedModels: string[] | undefined = undefined;
      if (!selectedModelPills.includes('*')) {
        allowedModels = selectedModelPills;
      }
      if (newCapyKey.allowed_models.trim()) {
        const extra = newCapyKey.allowed_models.split(',').map((s) => s.trim()).filter(Boolean);
        allowedModels = Array.from(new Set([...(allowedModels || []), ...extra]));
      }

      if (editingCapyKeyId) {
        await updateCapyKey(editingCapyKeyId, {
          name: newCapyKey.name.trim(),
          pool_id: newCapyKey.pool_id || undefined,
          rate_limit_rpm: Number(newCapyKey.rate_limit_rpm) || 0,
          budget_type: newCapyKey.budget_type,
          budget_cadence: newCapyKey.budget_cadence,
          budget_limit: Number(newCapyKey.budget_limit) || 0,
          budget_monthly_usd: newCapyKey.budget_type === 'usd' ? (Number(newCapyKey.budget_limit) || 0) : 0,
          allowed_models: allowedModels,
          include_metadata: newCapyKey.include_metadata,
        });
        setShowAddCapyKeyModal(false);
        setEditingCapyKeyId(null);
        await loadData();
        showToast(t('toast.capykey_updated'));
      } else {
        const res = await createCapyKey({
          name: newCapyKey.name.trim(),
          pool_id: newCapyKey.pool_id || undefined,
          rate_limit_rpm: Number(newCapyKey.rate_limit_rpm) || 0,
          budget_type: newCapyKey.budget_type,
          budget_cadence: newCapyKey.budget_cadence,
          budget_limit: Number(newCapyKey.budget_limit) || 0,
          budget_monthly_usd: newCapyKey.budget_type === 'usd' ? (Number(newCapyKey.budget_limit) || 0) : 0,
          allowed_models: allowedModels,
          include_metadata: newCapyKey.include_metadata,
        });

        setShowAddCapyKeyModal(false);
        setCreatedCapyKeySecret(res.virtual_key.full_key);
        setCopiedSecret(false);
        await loadData();
        showToast(t('common.success'));
      }
    } catch (err: any) {
      setCapyKeyModalError(err.message || t('common.error'));
    }
  };

  const handleDeleteCapyKey = async (id: string) => {
    if (!confirm(t('keys.revoke_confirm'))) return;
    try {
      await deleteCapyKey(id);
      await loadData();
      showToast(t('common.success'));
    } catch (err: any) {
      showToast(err.message || 'Errore', false);
    }
  };

  const handleResetCapyKeySpend = async (id: string) => {
    try {
      await resetCapyKeySpend(id);
      await loadData();
      showToast(t('toast.counter_reset'));
    } catch (err: any) {
      showToast(err.message || t('common.error'), false);
    }
  };

  const handleCopySecret = () => {
    if (createdCapyKeySecret) {
      navigator.clipboard.writeText(createdCapyKeySecret);
      setCopiedSecret(true);
      showToast(t('toast.copied'));
      setTimeout(() => setCopiedSecret(false), 2000);
    }
  };

  // Pricing & Catalog Handlers
  const handleOpenPricingForModel = (modelName: string, provider?: string, upstreamKeyId?: string) => {
    setActiveTab('pricing');
    setEditingPricingId(null);
    setPricingModalError(null);
    setNewPricingRule({
      model: modelName,
      provider: provider || '',
      upstream_key_id: upstreamKeyId || '',
      capy_key_id: '',
      prompt_price_per_1m: 0,
      completion_price_per_1m: 0,
    });
    setShowAddPricingModal(true);
  };

  const handleOpenEditPricing = (rule: PricingRule) => {
    setEditingPricingId(rule.id);
    setPricingModalError(null);
    setNewPricingRule({
      model: rule.model,
      provider: rule.provider || '',
      upstream_key_id: rule.upstream_key_id || '',
      capy_key_id: rule.capy_key_id || '',
      prompt_price_per_1m: rule.prompt_price_per_1m,
      completion_price_per_1m: rule.completion_price_per_1m,
    });
    setShowAddPricingModal(true);
  };

  const handleSavePricingRule = async (e: React.FormEvent) => {
    e.preventDefault();
    setPricingModalError(null);
    try {
      if (editingPricingId) {
        await updatePricingRule(editingPricingId, {
          model: newPricingRule.model.trim(),
          provider: newPricingRule.provider ? newPricingRule.provider.trim() : null,
          upstream_key_id: newPricingRule.upstream_key_id ? newPricingRule.upstream_key_id.trim() : null,
          capy_key_id: newPricingRule.capy_key_id ? newPricingRule.capy_key_id.trim() : null,
          prompt_price_per_1m: Number(newPricingRule.prompt_price_per_1m) || 0,
          completion_price_per_1m: Number(newPricingRule.completion_price_per_1m) || 0,
        });
        showToast(t('toast.pricing_updated'));
      } else {
        await createPricingRule({
          model: newPricingRule.model.trim(),
          provider: newPricingRule.provider ? newPricingRule.provider.trim() : null,
          upstream_key_id: newPricingRule.upstream_key_id ? newPricingRule.upstream_key_id.trim() : null,
          capy_key_id: newPricingRule.capy_key_id ? newPricingRule.capy_key_id.trim() : null,
          prompt_price_per_1m: Number(newPricingRule.prompt_price_per_1m) || 0,
          completion_price_per_1m: Number(newPricingRule.completion_price_per_1m) || 0,
        });
        showToast(t('toast.pricing_created'));
      }
      setShowAddPricingModal(false);
      await loadData();
    } catch (err: any) {
      setPricingModalError(err.message || t('common.error'));
    }
  };

  const handleDeletePricingRule = async (id: string) => {
    if (!confirm(t('pricing.delete_confirm'))) return;
    try {
      await deletePricingRule(id);
      await loadData();
      showToast(t('toast.pricing_deleted'));
    } catch (err: any) {
      showToast(err.message || t('common.error'), false);
    }
  };

  const handleTestCatalogProvider = async (keyId: string) => {
    setCatalogTestingState((prev) => ({
      ...prev,
      [keyId]: { loading: true, msg: 'Test...', ok: true },
    }));
    try {
      const res = await testUpstreamKey(keyId);
      setCatalogTestingState((prev) => ({
        ...prev,
        [keyId]: {
          loading: false,
          msg: res.success ? `OK (${res.latency_ms}ms)` : (res.error || 'Errore'),
          ok: res.success,
        },
      }));
    } catch (err: any) {
      setCatalogTestingState((prev) => ({
        ...prev,
        [keyId]: { loading: false, msg: err.message || 'Errore', ok: false },
      }));
    }
  };

  const handleSyncModelsDev = async () => {
    setSyncingModelsDev(true);
    try {
      const res = await syncModelsDev();
      await loadData();
      showToast(t('pricing.sync_success', { providers: res.providers_count, models: res.models_count }));
    } catch (err: any) {
      showToast(err.message || t('pricing.sync_error'), false);
    } finally {
      setSyncingModelsDev(false);
    }
  };

  const handleSaveTelegram = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await saveTelegramSettings({
        is_enabled: telegramForm.is_enabled,
        bot_token: telegramForm.bot_token.trim() || undefined,
        chat_id: telegramForm.chat_id.trim(),
        notify_on_budget_warning: telegramForm.notify_on_budget_warning,
        notify_on_budget_exceeded: telegramForm.notify_on_budget_exceeded,
        notify_on_key_cooldown: telegramForm.notify_on_key_cooldown,
        notify_on_key_error: telegramForm.notify_on_key_error,
      });
      setTelegramConfig(res.settings);
      showToast(t('toast.telegram_saved'));
    } catch (err: any) {
      showToast(err.message || t('common.error'), false);
    }
  };

  const handleTestTelegram = async () => {
    setTelegramTesting(true);
    setTelegramTestNotice(null);
    try {
      const res = await testTelegramWebhook({
        bot_token: telegramForm.bot_token.trim() || undefined,
        chat_id: telegramForm.chat_id.trim() || undefined,
      });
      setTelegramTestNotice({ msg: res.message || 'Messaggio di prova inviato!', ok: true });
    } catch (err: any) {
      setTelegramTestNotice({ msg: err.message || 'Invio fallito', ok: false });
    } finally {
      setTelegramTesting(false);
    }
  };

  const loadSystemSettings = async () => {
    try {
      const data = await getSystemSettings();
      setSystemSettings(data);
      setSelectedResetHour(data.daily_reset_hour);
    } catch {}
  };

  const handleSaveResetHour = async () => {
    setSavingResetHour(true);
    setResetHourNotice(null);
    try {
      const res = await updateSystemSettings({ daily_reset_hour: selectedResetHour });
      setSelectedResetHour(res.daily_reset_hour);
      showToast(t('settings.reset_save_success'));
      setResetHourNotice({ ok: true, msg: t('settings.reset_save_success') });
      await loadSystemSettings();
    } catch (err: any) {
      setResetHourNotice({ ok: false, msg: err.message || t('common.error') });
      showToast(err.message || t('common.error'), false);
    } finally {
      setSavingResetHour(false);
    }
  };

  const handleClearLogs = async (days = 0) => {
    const confirmMsg = days > 0
      ? t('settings.logs_purge_confirm_days', { days })
      : t('logs.clear_confirm');
    if (!confirm(confirmMsg)) return;

    setClearingLogs(true);
    try {
      const res = await clearLogs(days);
      showToast(t('toast.logs_cleared', { count: res.deleted }));
      await loadData();
      const info = await getSystemInfo();
      setSystemInfo(info);
    } catch (err: any) {
      showToast(err.message || t('common.error'), false);
    } finally {
      setClearingLogs(false);
    }
  };

  // Quota variables
  const quotaLimit = stats?.quota?.daily_token_limit || 0;
  const quotaUsed = stats?.quota?.current_daily_tokens || stats?.today?.total_tokens || 0;
  const quotaPct = quotaLimit > 0 ? Math.min(100, Math.round((quotaUsed / quotaLimit) * 100)) : 0;

  const filteredCatalog = useMemo(() => {
    if (!catalogSearch) return catalog;
    const q = catalogSearch.toLowerCase().trim();
    return catalog.filter((item) => {
      if (item.model.toLowerCase().includes(q)) return true;
      if (item.metadata?.name?.toLowerCase().includes(q)) return true;
      if (item.aliases?.some((a: string) => a.toLowerCase().includes(q))) return true;
      return item.providers.some((p: any) => p.provider.toLowerCase().includes(q) || p.key_name.toLowerCase().includes(q));
    });
  }, [catalog, catalogSearch]);

  const filteredPricingRules = useMemo(() => {
    return pricingRules.filter((r) => {
      if (pricingFilter.model && !r.model.toLowerCase().includes(pricingFilter.model.toLowerCase())) {
        return false;
      }
      if (pricingFilter.provider && (r.provider || '').toLowerCase() !== pricingFilter.provider.toLowerCase()) {
        return false;
      }
      return true;
    });
  }, [pricingRules, pricingFilter]);

  if (currentView === 'docs') {
    return <Docs onBack={() => setCurrentView('dashboard')} capyKeys={capyKeys} />;
  }

  return (
    <div className="min-h-screen bg-canvas text-ink flex flex-col font-sans">
      {/* Top Header - Clean, modern and spacious */}
      <header className="border-b border-hairline bg-surface sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CapyLogo size={32} />
            <div className="flex items-center gap-2">
              <span className="font-bold text-lg tracking-tight">CapyLLM</span>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-2.5">
            {/* Docs & Guide Button */}
            <button
              type="button"
              className="ds-btn ds-btn--secondary ds-btn--sm flex items-center gap-1.5 cursor-pointer"
              onClick={() => setCurrentView('docs')}
              title={t('header.docs')}
            >
              <BookOpen size={14} className="text-accent" />
              <span className="hidden sm:inline">{t('header.docs')}</span>
            </button>

            {/* Dark Mode */}
            <button
              type="button"
              className="ds-btn ds-btn--secondary ds-btn--sm flex items-center justify-center cursor-pointer p-2"
              onClick={handleToggleTheme}
              title={t('header.theme_toggle')}
            >
              {dark ? <Sun size={14} /> : <Moon size={14} />}
            </button>

            {/* System Menu Dropdown (Hamburger) */}
            <div className="relative">
              <button
                type="button"
                className="ds-btn ds-btn--secondary ds-btn--sm flex items-center gap-1.5 cursor-pointer relative"
                onClick={() => setShowMenuDropdown(!showMenuDropdown)}
                title={t('header.menu')}
                aria-label={t('header.menu')}
              >
                <Menu size={15} />
                <span className="text-xs text-muted hidden md:inline max-w-[150px] truncate">{user.email}</span>
                {telegramConfig?.is_enabled && (
                  <span className="w-2 h-2 rounded-full bg-accent absolute -top-0.5 -right-0.5" />
                )}
              </button>

              {showMenuDropdown && (
                <>
                  <div
                    className="fixed inset-0 z-30"
                    onClick={() => setShowMenuDropdown(false)}
                  />
                  <div className="absolute right-0 mt-2 w-64 bg-surface border border-hairline rounded-sm shadow-float z-40 p-2 flex flex-col gap-1 animate-in fade-in zoom-in-95 duration-100 text-xs">
                    {/* User Account Header */}
                    <div className="p-2 border-b border-hairline flex flex-col gap-0.5">
                      <span className="text-[10px] uppercase font-bold text-muted tracking-wider">{t('header.account')}</span>
                      <div className="font-semibold text-ink truncate">{user.email}</div>
                    </div>

                    {/* Impostazioni */}
                    <button
                      type="button"
                      onClick={() => { setShowMenuDropdown(false); handleOpenSettings('telegram'); }}
                      className="flex items-center justify-between p-2 rounded-xs hover:bg-sunken text-ink transition-colors cursor-pointer text-left"
                    >
                      <div className="flex items-center gap-2">
                        <Settings size={14} className="text-muted" />
                        <span>{t('header.settings')}</span>
                      </div>
                      {telegramConfig?.is_enabled && (
                        <span className="ds-badge ds-badge--accent text-[9px]">Attivo</span>
                      )}
                    </button>

                    {/* Informazioni */}
                    <button
                      type="button"
                      onClick={() => { setShowMenuDropdown(false); setShowAboutModal(true); }}
                      className="flex items-center gap-2 p-2 rounded-xs hover:bg-sunken text-ink transition-colors cursor-pointer text-left"
                    >
                      <Info size={14} className="text-muted" />
                      <span>{t('header.about')}</span>
                    </button>

                    <div className="border-t border-hairline my-1" />

                    {/* Lingua */}
                    <div className="p-2 flex items-center justify-between">
                      <span className="text-muted">{t('header.language')}</span>
                      <div className="flex items-center rounded-xs border border-hairline bg-surface p-0.5 font-semibold text-[11px]">
                        <button
                          type="button"
                          onClick={() => setLang('it')}
                          className={`px-2 py-0.5 rounded-2xs transition-colors cursor-pointer ${lang === 'it' ? 'bg-accent/15 text-accent font-bold' : 'text-muted hover:text-ink'}`}
                        >
                          IT
                        </button>
                        <button
                          type="button"
                          onClick={() => setLang('en')}
                          className={`px-2 py-0.5 rounded-2xs transition-colors cursor-pointer ${lang === 'en' ? 'bg-accent/15 text-accent font-bold' : 'text-muted hover:text-ink'}`}
                        >
                          EN
                        </button>
                      </div>
                    </div>

                    <div className="border-t border-hairline my-1" />

                    {/* Disconnetti */}
                    <button
                      type="button"
                      onClick={() => { setShowMenuDropdown(false); handleLogoutClick(); }}
                      className="flex items-center gap-2 p-2 rounded-xs hover:bg-err/10 text-err-text transition-colors cursor-pointer text-left font-medium"
                    >
                      <LogOut size={14} />
                      <span>{t('header.logout')}</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Container - Airy and elegant */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8 flex flex-col gap-8">
        {/* Floating Toast Notification (Non-shifting) */}
        {toastNotice && (
          <div className="fixed bottom-6 right-6 z-50 p-3.5 rounded-sm border shadow-lg flex items-center gap-3 bg-surface border-ok-text text-ok-text animate-in fade-in slide-in-from-bottom-2 duration-150">
            {toastNotice.ok ? <Check size={16} /> : <AlertTriangle size={16} />}
            <span className="text-sm font-medium">{toastNotice.msg}</span>
            <button type="button" onClick={() => setToastNotice(null)} className="text-muted hover:text-ink cursor-pointer ml-2 p-0.5"><X size={14} /></button>
          </div>
        )}

        {errorNotice && (
          <div className="ds-alert ds-alert--err flex justify-between items-center">
            <span className="flex items-center gap-2 text-sm">
              <AlertTriangle size={16} />
              {errorNotice}
            </span>
            <button type="button" onClick={() => setErrorNotice(null)} className="text-muted hover:text-ink cursor-pointer p-0.5"><X size={14} /></button>
          </div>
        )}

        {/* 1. Primary Navigation Bar - 6 Clear & Well-Defined Tabs */}
        <nav className="flex items-center justify-between border-b border-hairline pb-2 overflow-x-auto">
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <button
              type="button"
              className={`px-3 py-2 text-sm font-medium rounded-sm flex items-center gap-2 transition-all cursor-pointer ${activeTab === 'analytics' ? 'bg-surface border border-hairline font-semibold text-accent shadow-xs' : 'text-muted hover:text-ink'}`}
              onClick={() => setActiveTab('analytics')}
            >
              <BarChart3 size={16} />
              <span>{t('nav.analytics')}</span>
            </button>
            <button
              type="button"
              className={`px-3 py-2 text-sm font-medium rounded-sm flex items-center gap-2 transition-all cursor-pointer ${activeTab === 'capykeys' ? 'bg-surface border border-hairline font-semibold text-accent shadow-xs' : 'text-muted hover:text-ink'}`}
              onClick={() => setActiveTab('capykeys')}
            >
              <Key size={16} />
              <span>{t('nav.capykeys')}</span>
              {capyKeys.length > 0 && <span className="ds-badge ds-badge--sm text-xs">{capyKeys.length}</span>}
            </button>
            <button
              type="button"
              className={`px-3 py-2 text-sm font-medium rounded-sm flex items-center gap-2 transition-all cursor-pointer ${activeTab === 'pools' ? 'bg-surface border border-hairline font-semibold text-accent shadow-xs' : 'text-muted hover:text-ink'}`}
              onClick={() => setActiveTab('pools')}
            >
              <Layers size={16} />
              <span>{t('nav.pools')}</span>
              {pools.length > 0 && <span className="ds-badge ds-badge--sm text-xs">{pools.length}</span>}
            </button>
            <button
              type="button"
              className={`px-3 py-2 text-sm font-medium rounded-sm flex items-center gap-2 transition-all cursor-pointer ${activeTab === 'providers' ? 'bg-surface border border-hairline font-semibold text-accent shadow-xs' : 'text-muted hover:text-ink'}`}
              onClick={() => setActiveTab('providers')}
            >
              <Cpu size={16} />
              <span>{t('nav.providers')}</span>
              {keys.length > 0 && <span className="ds-badge ds-badge--sm text-xs">{keys.length}</span>}
            </button>
            <button
              type="button"
              className={`px-3 py-2 text-sm font-medium rounded-sm flex items-center gap-2 transition-all cursor-pointer ${activeTab === 'pricing' ? 'bg-surface border border-hairline font-semibold text-accent shadow-xs' : 'text-muted hover:text-ink'}`}
              onClick={() => setActiveTab('pricing')}
            >
              <Coins size={16} />
              <span>{t('nav.pricing')}</span>
            </button>
            <button
              type="button"
              className={`px-3 py-2 text-sm font-medium rounded-sm flex items-center gap-2 transition-all cursor-pointer ${activeTab === 'logs' ? 'bg-surface border border-hairline font-semibold text-accent shadow-xs' : 'text-muted hover:text-ink'}`}
              onClick={() => setActiveTab('logs')}
            >
              <Activity size={16} />
              <span>{t('nav.logs')}</span>
            </button>
          </div>
        </nav>

        {/* ========================================================================= */}
        {/* VIEW 1: STATISTICHE (ANALYTICS - AIRY OPENAI / OPENROUTER STYLE) */}
        {/* ========================================================================= */}
        {activeTab === 'analytics' && (
          <div className="flex flex-col gap-8 animate-in fade-in duration-150">
            {/* Zero-to-One Onboarding banner if no keys added yet */}
            {keys.length === 0 && (
              <div className="p-6 bg-surface border border-hairline rounded-sm shadow-card flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div className="flex items-start gap-3.5">
                  <div className="p-2.5 rounded-sm bg-accent/10 text-accent shrink-0">
                    <Sparkles size={24} />
                  </div>
                  <div>
                    <h3 className="font-bold text-base text-ink">{t('analytics.onboarding_title')}</h3>
                    <p className="text-sm text-muted mt-1 leading-relaxed">
                      {t('analytics.onboarding_desc')}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  className="ds-btn ds-btn--primary whitespace-nowrap self-stretch sm:self-auto"
                  onClick={() => setShowAddKeyModal(true)}
                >
                  {t('analytics.onboarding_btn')}
                </button>
              </div>
            )}

            {/* Daily Quota Hero Meter (if quota limit configured, e.g. 2.5M OpenAI) */}
            {quotaLimit > 0 && (
              <div className="p-6 bg-surface border border-hairline rounded-sm shadow-card flex flex-col gap-3">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                  <div>
                    <span className="text-xs uppercase tracking-wider font-semibold text-muted">{t('analytics.quota_title')}</span>
                    <h2 className="text-2xl font-bold tracking-tight text-ink mt-0.5">
                      {t('analytics.quota_used', { used: quotaUsed.toLocaleString(), limit: quotaLimit.toLocaleString() })}
                    </h2>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`ds-badge text-xs font-semibold ${quotaPct >= 90 ? 'ds-badge--err' : quotaPct >= 70 ? 'ds-badge--warn' : 'ds-badge--accent'}`}>
                      {t('analytics.quota_pct', { pct: quotaPct })}
                    </span>
                    <span className="text-xs text-muted">{t('analytics.quota_reset')}</span>
                  </div>
                </div>

                <div
                  className={`ds-progress ${quotaPct >= 90 ? 'ds-progress--err' : quotaPct >= 70 ? 'ds-progress--warn' : 'ds-progress--ok'} h-2.5 rounded-sm`}
                  style={{ '--ds-value': `${quotaPct}%` } as React.CSSProperties}
                >
                  <span className="ds-progress__bar" />
                </div>
              </div>
            )}

            {/* 4 Clean Metric Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-5 bg-surface border border-hairline rounded-sm shadow-xs flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted">{t('analytics.kpi_tokens_today')}</span>
                <div className="text-2xl font-bold tracking-tight text-ink">
                  {(stats?.today?.total_tokens || 0).toLocaleString()}
                </div>
                <div className="text-xs text-muted flex items-center gap-1.5">
                  <span>{(stats?.today?.prompt_tokens || 0).toLocaleString()} in</span>
                  <span>•</span>
                  <span>{(stats?.today?.completion_tokens || 0).toLocaleString()} out</span>
                </div>
              </div>

              <div className="p-5 bg-surface border border-hairline rounded-sm shadow-xs flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted">{t('analytics.kpi_requests')}</span>
                <div className="text-2xl font-bold tracking-tight text-ink">
                  {(stats?.total_requests || 0).toLocaleString()}
                </div>
                <div className="text-xs text-muted">
                  {t('analytics.kpi_requests_success', { pct: stats?.error_rate_pct !== undefined ? Number((100 - stats.error_rate_pct).toFixed(1)) : 100 })}
                </div>
              </div>

              <div className="p-5 bg-surface border border-hairline rounded-sm shadow-xs flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted">{t('analytics.kpi_latency')}</span>
                <div className="text-2xl font-bold tracking-tight text-ink">
                  {stats?.avg_latency_ms || 0}<span className="text-sm font-normal text-muted">ms</span>
                </div>
                <div className="text-xs text-muted">
                  {t('analytics.kpi_latency_ttft', { ttft: stats?.avg_ttft_ms || 0 })}
                </div>
              </div>

              <div className="p-5 bg-surface border border-hairline rounded-sm shadow-xs flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted">{t('analytics.kpi_spend')}</span>
                <div className="text-2xl font-bold tracking-tight text-ink">
                  ${(stats?.total_spend_usd || 0).toFixed(4)}
                </div>
                <div className="text-xs text-muted">
                  {t('analytics.kpi_spend_desc')}
                </div>
              </div>
            </div>

            {/* 24-Hour Activity Chart (Hourly Token / Request Volume) */}
            {stats?.hourly_activity && stats.hourly_activity.length > 0 && (
              <div className="p-6 bg-surface border border-hairline rounded-sm shadow-xs flex flex-col gap-4">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-hairline pb-3">
                  <div>
                    <h3 className="font-bold text-base text-ink">{t('analytics.activity_title')}</h3>
                    <p className="text-xs text-muted mt-0.5">{t('analytics.activity_desc')}</p>
                  </div>
                  <div className="text-xs text-muted bg-sunken px-2.5 py-1 rounded-sm border border-hairline">
                    {hoveredHourIndex !== null && stats.hourly_activity[hoveredHourIndex] ? (
                      <span className="font-semibold text-ink">
                        {stats.hourly_activity[hoveredHourIndex].label} UTC: {stats.hourly_activity[hoveredHourIndex].tokens.toLocaleString()} token • {stats.hourly_activity[hoveredHourIndex].requests} req • ${stats.hourly_activity[hoveredHourIndex].cost_usd.toFixed(4)}
                      </span>
                    ) : (
                      <span>
                        Ultime 24h: {stats.hourly_activity.reduce((acc, h) => acc + h.tokens, 0).toLocaleString()} token instradati
                      </span>
                    )}
                  </div>
                </div>

                {/* 24 Bars */}
                {(() => {
                  const maxTokens = Math.max(...stats.hourly_activity.map((h) => h.tokens), 100);
                  return (
                    <div className="flex flex-col gap-2">
                      <div className="flex items-end gap-1.5 h-28 pt-4 px-1">
                        {stats.hourly_activity.map((h, idx) => {
                          const heightPct = h.tokens > 0 ? Math.max(Math.round((h.tokens / maxTokens) * 100), 8) : 4;
                          const isHovered = hoveredHourIndex === idx;
                          return (
                            <div
                              key={h.hour}
                              className="flex-1 flex flex-col justify-end h-full cursor-pointer relative group"
                              onMouseEnter={() => setHoveredHourIndex(idx)}
                              onMouseLeave={() => setHoveredHourIndex(null)}
                            >
                              <div
                                className={`w-full rounded-xs transition-all duration-200 ${
                                  isHovered
                                    ? 'bg-accent'
                                    : h.tokens > 0
                                    ? 'bg-accent/70 group-hover:bg-accent'
                                    : 'bg-sunken group-hover:bg-muted/30'
                                }`}
                                style={{ height: `${heightPct}%` }}
                              />
                            </div>
                          );
                        })}
                      </div>

                      {/* X-Axis Time Labels */}
                      <div className="flex justify-between items-center text-[10px] text-muted font-mono px-1 border-t border-hairline pt-1.5">
                        <span>{t('analytics.activity_24h_ago')}</span>
                        <span>-18h</span>
                        <span>-12h</span>
                        <span>-6h</span>
                        <span className="font-semibold text-accent">{t('analytics.activity_now')}</span>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Side-by-Side Breakdown: By App & By Model */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Box 1: Consumo per App (CapyKeys) */}
              <div className="p-6 bg-surface border border-hairline rounded-sm shadow-xs flex flex-col gap-4">
                <div className="flex justify-between items-center border-b border-hairline pb-3">
                  <div>
                    <h3 className="font-bold text-base text-ink">{t('analytics.by_app_title')}</h3>
                    <p className="text-xs text-muted mt-0.5">{t('analytics.by_app_desc')}</p>
                  </div>
                  <button
                    type="button"
                    className="text-xs text-accent font-medium hover:underline flex items-center gap-1 cursor-pointer"
                    onClick={() => setActiveTab('capykeys')}
                  >
                    <span>{t('analytics.by_app_manage')}</span>
                    <ArrowRight size={13} />
                  </button>
                </div>

                {!stats?.by_app || stats.by_app.length === 0 ? (
                  <div className="py-12 text-center text-xs text-muted">
                    {t('analytics.by_app_empty')}
                  </div>
                ) : (
                  <div className="flex flex-col gap-3.5">
                    {stats.by_app.map((app) => (
                      <div key={app.app_id} className="flex flex-col gap-1.5">
                        <div className="flex justify-between items-center text-xs">
                          <span className="font-semibold text-ink flex items-center gap-1.5">
                            <Key size={13} className="text-accent" />
                            <span>{app.app_name}</span>
                          </span>
                          <span className="text-muted">
                            {t('analytics.by_app_detail', { tokens: app.total_tokens.toLocaleString(), pct: app.percentage, cost: app.cost_usd.toFixed(4) })}
                          </span>
                        </div>
                        <div className="w-full bg-sunken h-2 rounded-sm overflow-hidden">
                          <div
                            className="bg-accent h-full rounded-sm transition-all duration-300"
                            style={{ width: `${Math.max(app.percentage, 4)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Box 2: Ripartizione per Modello e Fornitore */}
              <div className="p-6 bg-surface border border-hairline rounded-sm shadow-xs flex flex-col gap-4">
                <div className="flex justify-between items-center border-b border-hairline pb-3">
                  <div>
                    <h3 className="font-bold text-base text-ink">{t('analytics.by_model_title')}</h3>
                    <p className="text-xs text-muted mt-0.5">{t('analytics.by_model_desc')}</p>
                  </div>
                  <button
                    type="button"
                    className="text-xs text-accent font-medium hover:underline flex items-center gap-1 cursor-pointer"
                    onClick={() => setActiveTab('providers')}
                  >
                    <span>{t('analytics.by_model_manage')}</span>
                    <ArrowRight size={13} />
                  </button>
                </div>

                {!stats?.by_model || stats.by_model.length === 0 ? (
                  <div className="py-12 text-center text-xs text-muted">
                    {t('analytics.by_model_empty')}
                  </div>
                ) : (
                  <div className="flex flex-col gap-3.5">
                    {stats.by_model.map((m) => (
                      <div
                        key={`${m.provider}-${m.model}`}
                        className="flex flex-col gap-1.5 p-2 -mx-2 rounded-sm hover:bg-sunken/60 cursor-pointer transition-colors group"
                        onClick={() => handleOpenModelStats(m.model)}
                        title={t('analytics.by_model_tooltip')}
                      >
                        <div className="flex justify-between items-center text-xs gap-3">
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <span className="font-medium text-ink group-hover:text-accent transition-colors truncate max-w-[220px] sm:max-w-[340px]" title={m.model}>
                              {m.model}
                            </span>
                            <BarChart3 size={12} className="text-accent opacity-70 group-hover:opacity-100 shrink-0" />
                            <span className="ds-badge text-[10px] py-0 px-1 shrink-0">{m.provider}</span>
                          </div>
                          <span className="text-muted shrink-0 text-right font-mono text-[11px]">
                            {t('analytics.by_model_detail', { tokens: m.total_tokens.toLocaleString(), latency: m.avg_latency_ms })}
                          </span>
                        </div>
                        <div className="w-full bg-sunken h-2 rounded-sm overflow-hidden">
                          <div
                            className="bg-ink h-full rounded-sm transition-all duration-300"
                            style={{ width: `${Math.max(m.percentage, 4)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* VIEW 2: CAPYKEYS (LE TUE APPLICAZIONI) */}
        {/* ========================================================================= */}
        {activeTab === 'capykeys' && (
          <div className="flex flex-col gap-6 animate-in fade-in duration-150">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <h2 className="text-lg font-bold text-ink">{t('keys.title')}</h2>
                <p className="text-xs text-muted mt-0.5">
                  {t('keys.desc')}
                </p>
              </div>
              <button
                type="button"
                className="ds-btn ds-btn--primary ds-btn--sm flex items-center gap-1.5"
                onClick={handleOpenAddCapyKeyModal}
              >
                <Plus size={15} />
                <span>{t('keys.create_btn')}</span>
              </button>
            </div>

            <div className="bg-surface border border-hairline rounded-sm shadow-xs overflow-hidden">
              <div className="ds-table-wrap">
                <table className="ds-table">
                  <thead>
                    <tr>
                      <th>{t('keys.col_app')}</th>
                      <th>{t('keys.col_pool')}</th>
                      <th>{t('keys.col_budget')}</th>
                      <th>{t('keys.col_models')}</th>
                      <th>{t('keys.col_status')}</th>
                      <th className="ds-table__num">{t('keys.col_actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {capyKeys.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="text-center py-12 text-muted text-xs">
                          {t('keys.empty')}
                        </td>
                      </tr>
                    ) : (
                      capyKeys.map((vk) => {
                        const isTokenBudget = vk.budget_type === 'tokens';
                        const limit = vk.budget_limit || (isTokenBudget ? 0 : (vk.budget_monthly_usd || 0));
                        const currentSpend = isTokenBudget ? (vk.current_spend_tokens || 0) : (vk.current_spend_usd || 0);
                        const pct = limit > 0 ? Math.min(100, Math.round((currentSpend / limit) * 100)) : 0;
                        const cadence = vk.budget_cadence || 'monthly';
                        const cadenceLabel = cadence === 'daily' ? t('keys.cadence_daily') : cadence === 'weekly' ? t('keys.cadence_weekly') : cadence === 'one-shot' ? t('keys.cadence_oneshot') : t('keys.cadence_monthly');

                        let parsedModels: string[] = [];
                        try {
                          if (vk.allowed_models) parsedModels = JSON.parse(vk.allowed_models);
                        } catch {}

                        return (
                          <tr key={vk.id}>
                            <td>
                              <div className="font-semibold text-ink flex items-center gap-1.5">
                                <Key size={14} className="text-accent" />
                                <span>{vk.name}</span>
                              </div>
                              <span className="text-xs text-muted">{vk.key_prefix}...</span>
                            </td>
                            <td>
                              <span className="ds-badge text-xs font-semibold flex items-center gap-1 w-fit">
                                <Layers size={11} className="text-accent" />
                                <span>{vk.pool_name || vk.pool_id || t('keys.no_pool')}</span>
                              </span>
                            </td>
                            <td className="w-56">
                              {limit > 0 ? (
                                <div className="flex flex-col gap-1">
                                  <div className="flex justify-between items-center text-xs">
                                    <span className="font-medium">
                                      {isTokenBudget ? `${currentSpend.toLocaleString()} / ${limit.toLocaleString()}` : `$${currentSpend.toFixed(2)} / $${limit.toFixed(2)}`}
                                    </span>
                                    <span className="text-[11px] text-muted">{cadenceLabel}</span>
                                  </div>
                                  <div
                                    className={`ds-progress ${pct >= 90 ? 'ds-progress--err' : pct >= 70 ? 'ds-progress--warn' : 'ds-progress--ok'} h-1.5`}
                                    style={{ '--ds-value': `${pct}%` } as React.CSSProperties}
                                  >
                                    <span className="ds-progress__bar" />
                                  </div>
                                </div>
                              ) : (
                                <span className="text-xs text-muted">
                                  {isTokenBudget
                                    ? `${t('providers.no_limit')} (${currentSpend.toLocaleString()} token)`
                                    : `${t('providers.no_limit')} ($${currentSpend.toFixed(4)})`}
                                </span>
                              )}
                            </td>
                            <td className="text-xs text-muted">
                              {parsedModels.length > 0 ? parsedModels.join(', ') : t('keys.all_models')}
                            </td>
                            <td>
                              {vk.is_active ? (
                                <span className="ds-badge ds-badge--ok text-xs">{t('keys.status_active')}</span>
                              ) : (
                                <span className="ds-badge ds-badge--err text-xs">{t('keys.status_revoked')}</span>
                              )}
                            </td>
                            <td className="ds-table__num">
                              <div className="flex items-center justify-end gap-2">
                                <button
                                  type="button"
                                  className="ds-btn ds-btn--secondary ds-btn--sm text-xs flex items-center gap-1"
                                  onClick={() => handleOpenEditCapyKey(vk)}
                                  title={t('keys.action_edit')}
                                >
                                  <Pencil size={12} />
                                  <span>{t('common.edit')}</span>
                                </button>
                                <button
                                  type="button"
                                  className="ds-btn ds-btn--secondary ds-btn--sm text-xs"
                                  onClick={() => handleResetCapyKeySpend(vk.id)}
                                >
                                  {t('keys.action_reset')}
                                </button>
                                <button
                                  type="button"
                                  className="ds-btn ds-btn--ghost ds-btn--sm text-xs text-err-text hover:bg-err/10"
                                  onClick={() => handleDeleteCapyKey(vk.id)}
                                >
                                  {t('keys.action_revoke')}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* VIEW 3: POOL DI INFERENZA & FAILOVER */}
        {/* ========================================================================= */}
        {activeTab === 'pools' && (
          <div className="flex flex-col gap-6 animate-in fade-in duration-150">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <h2 className="text-lg font-bold text-ink">{t('pools.title')}</h2>
                <p className="text-xs text-muted mt-0.5">
                  {t('pools.desc')}
                </p>
              </div>
              <button
                type="button"
                className="ds-btn ds-btn--primary ds-btn--sm flex items-center gap-1.5"
                onClick={handleOpenAddPool}
              >
                <Plus size={15} />
                <span>{t('pools.create_btn')}</span>
              </button>
            </div>

            {/* Routing & Normalization Info Banner (Permanently Dismissible) */}
            {!hidePoolRoutingBanner && (
              <div className="p-3.5 bg-sunken/60 border border-hairline rounded-sm flex items-start sm:items-center justify-between gap-3 text-xs leading-relaxed">
                <div className="flex items-start gap-2.5">
                  <Sliders size={15} className="text-muted shrink-0 mt-0.5" />
                  <div className="text-muted">
                    <span className="font-semibold text-ink mr-1.5">{t('pools.routing_banner_title')}:</span>
                    {t('pools.routing_banner_desc')}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setHidePoolRoutingBanner(true);
                    try {
                      localStorage.setItem('capy_pool_routing_dismissed', '1');
                    } catch {}
                  }}
                  className="text-xs text-muted hover:text-ink shrink-0 underline decoration-dotted transition-colors ml-2 cursor-pointer"
                >
                  {t('pools.routing_banner_dismiss')}
                </button>
              </div>
            )}

            {pools.length === 0 ? (
              <div className="p-12 text-center bg-surface border border-hairline rounded-sm">
                <Layers size={32} className="mx-auto text-muted mb-2" />
                <h3 className="font-bold text-sm text-ink">{t('pools.empty')}</h3>
                <p className="text-xs text-muted mt-1 max-w-md mx-auto">
                  {t('pools.empty_desc')}
                </p>
                <button
                  type="button"
                  className="ds-btn ds-btn--primary ds-btn--sm mt-4"
                  onClick={() => setShowAddPoolModal(true)}
                >
                  {t('pools.create_btn')}
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-6">
                {pools.map((p) => {
                  const isTokenBudget = p.budget_type === 'tokens';
                  const limit = p.budget_limit || 0;
                  const currentSpend = isTokenBudget ? (p.current_spend_tokens || 0) : (p.current_spend_usd || 0);
                  const pct = limit > 0 ? Math.min(100, Math.round((currentSpend / limit) * 100)) : 0;
                  const cadenceLabel = p.budget_cadence === 'daily' ? t('keys.cadence_daily') : p.budget_cadence === 'weekly' ? t('keys.cadence_weekly') : p.budget_cadence === 'one-shot' ? t('keys.cadence_oneshot') : t('keys.cadence_monthly');
                  const routes: any[] = p.routes || [];

                  return (
                    <div key={p.id} className="p-6 bg-surface border border-hairline rounded-sm shadow-xs flex flex-col gap-4">
                      {/* Pool Header */}
                      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-hairline pb-4">
                        <div className="flex items-center gap-3">
                          <div className="p-2.5 rounded-sm bg-accent/10 text-accent">
                            <Layers size={20} />
                          </div>
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <h3 className="font-bold text-base text-ink">{p.name}</h3>
                              <span className="text-xs font-mono text-muted bg-sunken px-1.5 py-0.5 rounded-xs border border-hairline">{p.id}</span>
                            </div>
                            <p className="text-xs text-muted mt-0.5">
                              {p.description || t('pools.no_description')}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 self-end sm:self-auto">
                          <button
                            type="button"
                            className="ds-btn ds-btn--secondary ds-btn--sm text-xs flex items-center gap-1.5"
                            onClick={() => handleOpenEditPool(p)}
                            title={t('pools.action_edit')}
                          >
                            <Pencil size={13} />
                            <span>{t('common.edit')}</span>
                          </button>
                          <button
                            type="button"
                            className="ds-btn ds-btn--secondary ds-btn--sm text-xs flex items-center gap-1.5"
                            onClick={() => handleOpenAddRoute(p)}
                          >
                            <Plus size={13} />
                            <span>{t('pools.add_key_to_pool')}</span>
                          </button>
                          <button
                            type="button"
                            className="ds-btn ds-btn--ghost ds-btn--sm text-xs text-err-text"
                            onClick={() => handleDeletePool(p.id)}
                            title={t('common.delete')}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>

                      {/* Pool Budget Bar */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-3 bg-sunken rounded-sm border border-hairline text-xs">
                        <div className="flex flex-col gap-1">
                          <span className="text-muted font-medium">{t('pools.autonomous_budget')}</span>
                          <span className="font-semibold text-ink">
                            {limit > 0 ? (
                              isTokenBudget ? `${limit.toLocaleString()} token (${cadenceLabel})` : `$${limit.toFixed(2)} (${cadenceLabel})`
                            ) : (
                              t('pools.no_limit')
                            )}
                          </span>
                        </div>

                        <div className="flex flex-col gap-1">
                          <span className="text-muted font-medium">{t('pools.current_spend')}</span>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-ink">
                              {isTokenBudget ? `${currentSpend.toLocaleString()} token` : `$${currentSpend.toFixed(4)}`}
                            </span>
                            {limit > 0 && (
                              <span className={`ds-badge text-[10px] font-semibold ${pct >= 90 ? 'ds-badge--err' : pct >= 70 ? 'ds-badge--warn' : 'ds-badge--ok'}`}>
                                {pct}%
                              </span>
                            )}
                          </div>
                          {limit > 0 && (
                            <div
                              className={`ds-progress ${pct >= 90 ? 'ds-progress--err' : pct >= 70 ? 'ds-progress--warn' : 'ds-progress--ok'} h-1.5 mt-0.5`}
                              style={{ '--ds-value': `${pct}%` } as React.CSSProperties}
                            >
                              <span className="ds-progress__bar" />
                            </div>
                          )}
                        </div>

                        <div className="flex flex-col gap-1">
                          <span className="text-muted font-medium">{t('pools.linked_apps')}</span>
                          <span className="font-semibold text-ink">
                            {t('pools.apps_count', { count: p.capykey_count || p.virtual_keys_count || 0 })}
                          </span>
                        </div>
                      </div>

                      {/* Routes (Priority and Failover Sequence) */}
                      <div className="flex flex-col gap-2 mt-2">
                        <div className="flex justify-between items-center">
                          <span className="text-xs font-bold uppercase tracking-wider text-muted">
                            {t('pools.col_routes')}
                          </span>
                          <span className="text-xs text-muted">{t('pools.priority_hint')}</span>
                        </div>

                        {routes.length === 0 ? (
                          <div className="py-6 text-center text-xs text-muted border border-dashed border-hairline rounded-sm">
                            {t('pools.no_routes')}
                          </div>
                        ) : (
                          <div className="flex flex-col gap-2">
                            {routes.map((route: any, index: number) => {
                              const isFirst = index === 0;
                              const isLast = index === routes.length - 1;
                              const routeLimit = route.token_limit || 0;
                              const routeUsed = route.current_tokens || 0;
                              const routePct = routeLimit > 0 ? Math.min(100, Math.round((routeUsed / routeLimit) * 100)) : 0;
                              const isRouteExhausted = routeLimit > 0 && routeUsed >= routeLimit;

                              return (
                                <div
                                  key={route.route_id || route.id || index}
                                  className="p-3 bg-surface border border-hairline rounded-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs"
                                >
                                  <div className="flex items-center gap-3">
                                    <span className={`px-2 py-0.5 rounded-xs font-bold font-mono text-[11px] shrink-0 ${index === 0 ? 'bg-accent/15 text-accent border border-accent/30' : 'bg-sunken text-muted border border-hairline'}`}>
                                      P{index}
                                    </span>
                                    <div>
                                      <div className="font-semibold text-ink flex items-center gap-2">
                                        <span>{route.upstream_key_name || route.upstream_key_id}</span>
                                        <span className="ds-badge text-[10px]">{route.provider || 'provider'}</span>
                                      </div>
                                      <div className="flex flex-wrap items-center gap-2 mt-0.5 text-[11px] text-muted">
                                        <span>
                                          {t('pools.route_pattern')}: <code className="font-mono bg-sunken px-1 rounded-xs text-ink font-semibold">{route.model_pattern || '*'}</code>
                                        </span>
                                        <span>•</span>
                                        {routeLimit > 0 ? (
                                          <span className="flex items-center gap-1.5">
                                            <span>{t('pools.route_tokens', { used: routeUsed.toLocaleString(), limit: routeLimit.toLocaleString() })}</span>
                                            <span className={`ds-badge text-[9px] py-0 px-1 ${isRouteExhausted ? 'ds-badge--err' : 'ds-badge--ok'}`}>
                                              {routePct}%
                                            </span>
                                          </span>
                                        ) : (
                                          <span>{t('pools.route_unlimited')}</span>
                                        )}
                                        {route.reasoning_effort && route.reasoning_effort !== 'inherit' && (
                                          <>
                                            <span>•</span>
                                            <span className="ds-badge ds-badge--accent text-[9px] py-0 px-1 font-mono">
                                              effort: {route.reasoning_effort}
                                            </span>
                                          </>
                                        )}
                                      </div>
                                      {routeLimit > 0 && (
                                        <div
                                          className={`ds-progress ${routePct >= 90 ? 'ds-progress--err' : routePct >= 70 ? 'ds-progress--warn' : 'ds-progress--ok'} h-1 mt-1 w-32`}
                                          style={{ '--ds-value': `${routePct}%` } as React.CSSProperties}
                                        >
                                          <span className="ds-progress__bar" />
                                        </div>
                                      )}
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-1.5 self-end sm:self-auto shrink-0">
                                    {routeLimit > 0 && routeUsed > 0 && (
                                      <button
                                        type="button"
                                        className="ds-btn ds-btn--ghost ds-btn--sm py-1 px-2 text-[11px] text-muted hover:text-ink"
                                        onClick={() => handleResetRouteSpend(p.id, route.route_id)}
                                        title={t('pools.route_reset_spend')}
                                      >
                                        <RefreshCw size={11} className="mr-1" />
                                        <span>{t('pools.route_reset_spend')}</span>
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      className="ds-btn ds-btn--secondary ds-btn--sm py-1 px-2 text-xs flex items-center gap-1"
                                      onClick={() => handleOpenEditRoute(p, route, index)}
                                      title={t('pools.edit_route')}
                                    >
                                      <Pencil size={11} />
                                      <span className="hidden sm:inline">{t('common.edit')}</span>
                                    </button>
                                    <button
                                      type="button"
                                      className="ds-btn ds-btn--secondary ds-btn--sm py-1 px-2 text-xs flex items-center gap-1"
                                      disabled={isFirst}
                                      onClick={() => handleMoveRoute(p, index, 'up')}
                                      title={t('pools.move_up')}
                                    >
                                      <ArrowUp size={12} />
                                      <span className="hidden sm:inline">{t('pools.move_up')}</span>
                                    </button>
                                    <button
                                      type="button"
                                      className="ds-btn ds-btn--secondary ds-btn--sm py-1 px-2 text-xs flex items-center gap-1"
                                      disabled={isLast}
                                      onClick={() => handleMoveRoute(p, index, 'down')}
                                      title={t('pools.move_down')}
                                    >
                                      <ArrowDown size={12} />
                                      <span className="hidden sm:inline">{t('pools.move_down')}</span>
                                    </button>
                                    <button
                                      type="button"
                                      className="ds-btn ds-btn--ghost ds-btn--sm py-1 px-2 text-xs text-err-text ml-1"
                                      onClick={() => handleRemoveRoute(p, index)}
                                      title={t('pools.remove_route')}
                                    >
                                      <Trash2 size={13} />
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* VIEW 4: FORNITORI UPSTREAM (CHIAVI FORNITORE & SCHEMI API) */}
        {/* ========================================================================= */}
        {activeTab === 'providers' && (
          <div className="flex flex-col gap-6 animate-in fade-in duration-150">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <h2 className="text-lg font-bold text-ink">{t('providers.title')}</h2>
                <p className="text-xs text-muted mt-0.5">
                  {t('providers.desc')}
                </p>
              </div>
              <button
                type="button"
                className="ds-btn ds-btn--primary ds-btn--sm flex items-center gap-1.5"
                onClick={handleOpenAddKey}
              >
                <Plus size={15} />
                <span>{t('providers.add_key_btn')}</span>
              </button>
            </div>

            <div className="bg-surface border border-hairline rounded-sm shadow-xs overflow-hidden">
              <div className="ds-table-wrap">
                <table className="ds-table">
                  <thead>
                    <tr>
                      <th>{t('providers.col_provider')}</th>
                      <th>{t('providers.col_schema')}</th>
                      <th>{t('providers.col_key')}</th>
                      <th>{t('providers.col_quota')}</th>
                      <th>{t('providers.col_status')}</th>
                      <th className="ds-table__num">{t('providers.col_actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {keys.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="text-center py-12 text-muted text-xs">
                          {t('providers.empty')}
                        </td>
                      </tr>
                    ) : (
                      keys.map((k) => {
                        const models: string[] = Array.isArray(k.discovered_models) ? k.discovered_models : [];
                        const isExpanded = expandedModelsKeyId === k.id;
                        const limit = (k as any).budget_limit !== undefined && (k as any).budget_limit > 0 ? (k as any).budget_limit : (k.daily_token_limit || 0);
                        const type = (k as any).budget_type || 'tokens';
                        const cadence = (k as any).budget_cadence || 'daily';
                        const usedTokens = (k as any).current_spend_tokens || k.current_daily_tokens || 0;
                        const usedUsd = (k as any).current_spend_usd || 0;
                        const used = type === 'tokens' ? usedTokens : usedUsd;
                        const isExhausted = limit > 0 && used >= limit;

                        const cadenceLabel =
                          cadence === 'daily'
                            ? t('budget.status_tokens_today')
                            : cadence === 'weekly'
                            ? t('budget.status_tokens_this_week')
                            : cadence === 'monthly'
                            ? t('budget.status_tokens_this_month')
                            : t('budget.status_tokens_lifetime');

                        return (
                          <tr key={k.id}>
                            <td className="align-top">
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-ink">{k.name}</span>
                                <span className="ds-badge text-xs">{k.provider}</span>
                                {k.is_free_tier ? <span className="ds-badge ds-badge--accent text-[10px]">Free tier</span> : null}
                                {k.supported_schemas && Array.isArray(k.supported_schemas) && (
                                  <div className="flex items-center gap-1">
                                    {k.supported_schemas.includes('*') ? (
                                      <span className="ds-badge text-[10px] bg-sunken text-muted">all schemas</span>
                                    ) : (
                                      k.supported_schemas.map((s: string) => (
                                        <span key={s} className="ds-badge text-[10px] bg-sunken text-muted">
                                          {s === 'chat_completions' ? 'chat' : s === 'responses' ? 'resp' : s === 'embeddings' ? 'embed' : s === 'decision' ? 'decision' : s}
                                        </span>
                                      ))
                                    )}
                                  </div>
                                )}
                              </div>

                              <div className="mt-1 flex items-center gap-2">
                                {models.length > 0 ? (
                                  <button
                                    type="button"
                                    className="text-xs text-accent hover:underline flex items-center gap-1 cursor-pointer"
                                    onClick={() => setExpandedModelsKeyId(isExpanded ? null : k.id)}
                                  >
                                    <span>{t('providers.models_available', { count: models.length })}</span>
                                    {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                                  </button>
                                ) : (
                                  <span className="text-xs text-muted italic">{t('providers.no_models_synced')}</span>
                                )}
                              </div>

                              {isExpanded && models.length > 0 && (
                                <div className="mt-2.5 p-3 bg-sunken rounded-sm border border-hairline flex flex-wrap gap-1.5 max-w-lg">
                                  {models.map((m) => (
                                    <span key={m} className="px-2 py-0.5 text-xs bg-surface border border-hairline rounded-sm text-ink flex items-center gap-1.5">
                                      <span>{m}</span>
                                      <button
                                        type="button"
                                        className="text-accent hover:opacity-80 font-bold text-[11px] cursor-pointer"
                                        title={t('providers.set_rate_for', { model: m })}
                                        onClick={() => handleOpenPricingForModel(m, k.provider, k.id)}
                                      >
                                        $
                                      </button>
                                    </span>
                                  ))}
                                </div>
                              )}

                              {keyActionNotice && keyActionNotice.id === k.id && (
                                <div className={`mt-1.5 text-xs ${keyActionNotice.ok ? 'text-ok-text' : 'text-err-text'}`}>
                                  {keyActionNotice.msg}
                                </div>
                              )}
                            </td>
                            <td className="align-top text-xs">
                              <span className="ds-badge text-xs font-mono">
                                {k.api_schema || 'chat_completions'}
                              </span>
                              {k.custom_schema_config && (
                                <details className="mt-1">
                                  <summary className="text-[10px] text-muted cursor-pointer hover:text-ink">JSON schema</summary>
                                  <pre className="mt-1 p-1.5 bg-sunken rounded-xs text-[10px] font-mono overflow-x-auto max-w-xs whitespace-pre-wrap break-all">{k.custom_schema_config}</pre>
                                </details>
                              )}
                            </td>
                            <td className="align-top text-xs font-mono text-muted">
                              {k.masked_key || '••••••••••••'}
                            </td>
                            <td className="align-top">
                              {limit > 0 ? (
                                <div className="flex flex-col gap-1 w-44">
                                  <span className="text-xs font-medium text-ink">
                                    {type === 'tokens'
                                      ? `${usedTokens.toLocaleString()} / ${limit.toLocaleString()} token ${cadenceLabel}`
                                      : `$${usedUsd.toFixed(2)} / $${limit.toFixed(2)} USD ${cadenceLabel}`}
                                  </span>
                                  <div
                                    className={`ds-progress ${isExhausted ? 'ds-progress--err' : 'ds-progress--ok'} h-1.5`}
                                    style={{ '--ds-value': `${Math.min(100, Math.round((used / limit) * 100))}%` } as React.CSSProperties}
                                  >
                                    <span className="ds-progress__bar" />
                                  </div>
                                  {isExhausted && (
                                    <button
                                      type="button"
                                      onClick={() => handleResetUpstreamDailyTokens(k.id)}
                                      className="text-[11px] text-accent underline self-start cursor-pointer mt-0.5"
                                    >
                                      {t('providers.action_reset_tokens')}
                                    </button>
                                  )}
                                </div>
                              ) : (
                                <span className="text-xs text-muted">{t('providers.no_limit')}</span>
                              )}
                            </td>
                            <td className="align-top">
                              {isExhausted ? (
                                <span className="ds-badge ds-badge--warn text-xs">{t('providers.status_daily_paused')}</span>
                              ) : k.in_cooldown ? (
                                <div className="flex items-center gap-1.5">
                                  <span className="ds-badge ds-badge--warn text-xs">
                                    {t('providers.status_cooldown', { sec: Math.ceil((k.cooldown_until! - Date.now()) / 1000) })}
                                  </span>
                                  <button
                                    type="button"
                                    className="ds-btn ds-btn--secondary ds-btn--sm text-xs py-0 h-6"
                                    onClick={() => handleResetCooldown(k.id)}
                                  >
                                    {t('providers.action_reset_cooldown')}
                                  </button>
                                </div>
                              ) : k.is_active ? (
                                <span className="ds-badge ds-badge--ok text-xs">{t('providers.status_active')}</span>
                              ) : (
                                <span className="ds-badge ds-badge--err text-xs">{t('providers.status_error')}</span>
                              )}
                            </td>
                            <td className="ds-table__num align-top">
                              <div className="flex items-center justify-end gap-1.5 flex-wrap">
                                <button
                                  type="button"
                                  className="ds-btn ds-btn--secondary ds-btn--sm text-xs flex items-center gap-1"
                                  onClick={() => handleOpenEditKey(k)}
                                  title={t('providers.action_edit')}
                                >
                                  <Pencil size={12} />
                                  <span>{t('common.edit')}</span>
                                </button>
                                <button
                                  type="button"
                                  className="ds-btn ds-btn--secondary ds-btn--sm text-xs flex items-center gap-1"
                                  disabled={syncingKeyId === k.id}
                                  onClick={() => handleSyncModels(k.id)}
                                >
                                  <RefreshCw size={12} className={syncingKeyId === k.id ? 'animate-spin' : ''} />
                                  <span>{t('providers.action_sync')}</span>
                                </button>
                                <button
                                  type="button"
                                  className="ds-btn ds-btn--secondary ds-btn--sm text-xs"
                                  onClick={() => handleTestKey(k.id)}
                                >
                                  {t('providers.action_test')}
                                </button>
                                <button
                                  type="button"
                                  className="ds-btn ds-btn--ghost ds-btn--sm text-xs text-err-text"
                                  onClick={() => handleDeleteUpstreamKey(k.id)}
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Provider Reliability & Performance Leaderboard */}
            <div className="p-5 bg-surface border border-hairline rounded-sm shadow-xs flex flex-col gap-4">
              <div>
                <h3 className="font-bold text-sm text-ink">{t('providers.reliability_title')}</h3>
                <p className="text-xs text-muted mt-0.5">{t('providers.reliability_desc')}</p>
              </div>

              {(!stats?.provider_reliability || stats.provider_reliability.length === 0) ? (
                <div className="text-xs text-muted py-5 text-center bg-sunken rounded-sm border border-hairline">
                  {t('providers.no_reliability_data')}
                </div>
              ) : (
                <div className="ds-table-wrap">
                  <table className="ds-table">
                    <thead>
                      <tr>
                        <th>{t('providers.col_provider')}</th>
                        <th>{t('providers.col_success_rate')}</th>
                        <th className="ds-table__num">{t('providers.col_speed')}</th>
                        <th className="ds-table__num">{t('providers.col_avg_ttft')}</th>
                        <th className="ds-table__num">{t('providers.col_avg_latency')}</th>
                        <th className="ds-table__num">{t('providers.col_rate_limits')}</th>
                        <th className="ds-table__num">{t('providers.col_total_routed')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.provider_reliability.map((p) => (
                        <tr
                          key={p.provider}
                          onClick={() => setSelectedProviderForStats(p.provider)}
                          className="cursor-pointer hover:bg-sunken/80 transition-colors group"
                          title={t('providers.modal_stats_title')}
                        >
                          <td className="font-semibold text-xs text-ink">
                            <div className="flex items-center gap-2">
                              {p.provider_logo_url && (
                                <img src={p.provider_logo_url} alt="" className="w-4 h-4 object-contain shrink-0" />
                              )}
                              <span>{p.provider}</span>
                            </div>
                          </td>
                          <td>
                            <span className={`ds-badge text-[10px] font-mono font-semibold ${p.success_rate_pct >= 99 ? 'ds-badge--ok' : p.success_rate_pct >= 90 ? 'ds-badge--warn' : 'ds-badge--err'}`}>
                              {p.success_rate_pct}%
                            </span>
                          </td>
                          <td className="ds-table__num text-xs font-mono font-medium">
                            {p.tokens_per_sec > 0 ? `${p.tokens_per_sec} tok/s` : '—'}
                          </td>
                          <td className="ds-table__num text-xs font-mono text-muted">
                            {p.avg_ttft_ms > 0 ? `${p.avg_ttft_ms}ms` : '—'}
                          </td>
                          <td className="ds-table__num text-xs font-mono">
                            {p.avg_latency_ms}ms
                          </td>
                          <td className="ds-table__num text-xs font-mono">
                            {p.rate_limit_429_count > 0 ? (
                              <span className="text-warn font-semibold">{p.rate_limit_429_count}</span>
                            ) : (
                              <span className="text-muted">0</span>
                            )}
                          </td>
                          <td className="ds-table__num text-xs font-mono">
                            {p.total_requests.toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* VIEW 5: TARIFFE E CATALOGO MODELLI (DISCOVERED MODELS + RATES) */}
        {/* ========================================================================= */}
        {activeTab === 'pricing' && (
          <div className="flex flex-col gap-8 animate-in fade-in duration-150">
            {/* Part 1: Catalogo Modelli Rilevati */}
            <div className="flex flex-col gap-4">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                  <h2 className="text-lg font-bold text-ink">{t('pricing.title')}</h2>
                  <p className="text-xs text-muted mt-0.5">
                    {t('pricing.desc')}
                  </p>
                </div>
                <div className="flex items-center gap-2 self-stretch sm:self-auto">
                  <div className="relative flex-1 sm:w-72">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
                    <input
                      type="text"
                      placeholder={t('pricing.search_placeholder')}
                      value={catalogSearch}
                      onChange={(e) => setCatalogSearch(e.target.value)}
                      style={{ paddingLeft: '2.25rem' }}
                      className="ds-input text-xs w-full"
                    />
                  </div>
                  <button
                    type="button"
                    className="ds-btn ds-btn--secondary ds-btn--sm flex items-center gap-1.5 text-xs whitespace-nowrap"
                    onClick={handleSyncModelsDev}
                    disabled={syncingModelsDev}
                    title={t('pricing.sync_models_dev')}
                  >
                    <RefreshCw size={13} className={syncingModelsDev ? 'animate-spin text-accent' : ''} />
                    <span>{syncingModelsDev ? t('pricing.syncing') : t('pricing.sync_models_dev')}</span>
                  </button>
                  <button
                    type="button"
                    className="ds-btn ds-btn--secondary ds-btn--sm"
                    onClick={() => loadData()}
                    title={t('pricing.refresh_tooltip')}
                  >
                    <RefreshCw size={13} />
                  </button>
                </div>
              </div>

              <div className="bg-surface border border-hairline rounded-sm shadow-xs overflow-hidden">
                <div className="ds-table-wrap">
                  <table className="ds-table">
                    <thead>
                      <tr>
                        <th>{t('pricing.col_model')}</th>
                        <th>{t('pricing.col_provider')}</th>
                        <th className="ds-table__num">{t('pricing.col_input')}</th>
                        <th className="ds-table__num">{t('pricing.col_output')}</th>
                        <th className="ds-table__num">{t('pricing.col_actions')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCatalog.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="text-center py-12 text-muted text-xs">
                            {t('pricing.empty')}
                          </td>
                        </tr>
                      ) : (
                        filteredCatalog.map((item) => (
                          <React.Fragment key={item.model}>
                            {item.providers.map((prov: any, provIdx: number) => {
                              const testState = catalogTestingState[prov.key_id];
                              return (
                                <tr key={`${item.model}-${prov.key_id}`} className={provIdx > 0 ? 'border-t-0' : ''}>
                                  {provIdx === 0 ? (
                                    <td rowSpan={item.providers.length} className="align-top font-semibold text-xs text-ink bg-surface/50 border-r border-hairline min-w-[280px] w-80 p-4">
                                      <div className="flex flex-col gap-2">
                                        <div className="flex items-center gap-2 flex-wrap">
                                          <button
                                            type="button"
                                            onClick={() => { setSelectedModelForDetails(item); setShowRawJson(false); }}
                                            className="text-sm font-bold text-ink hover:text-accent cursor-pointer text-left transition-colors flex items-center gap-1.5 group"
                                            title={t('pricing.model_sheet_link')}
                                          >
                                            <span>{item.metadata?.name || item.model}</span>
                                            <Info size={13} className="text-muted group-hover:text-accent transition-colors" />
                                          </button>
                                          {item.metadata?.reasoning && (
                                            <span className="ds-badge ds-badge--accent text-[9px] py-0 px-1.5">Reasoning</span>
                                          )}
                                        </div>
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                          <span className="text-[11px] font-mono text-muted">{item.model}</span>
                                          {item.aliases && item.aliases.length > 0 && item.aliases.map((al: string) => (
                                            <span key={al} className="text-[10px] font-mono text-muted border border-hairline px-1 rounded-xs bg-sunken" title="Alias compatibile">
                                              alias: {al}
                                            </span>
                                          ))}
                                        </div>
                                        {item.metadata?.description && (
                                          <p className="text-[11px] text-muted line-clamp-2 font-normal leading-relaxed">
                                            {item.metadata.description}
                                          </p>
                                        )}
                                        {/* Modalities & Context Limits */}
                                        <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                                          {item.metadata?.limit?.context && (
                                            <span className="text-[10px] font-mono bg-sunken text-muted px-1.5 py-0.5 rounded-xs border border-hairline font-normal" title={t('pricing.context_window')}>
                                              {item.metadata.limit.context >= 1_000_000
                                                ? `${(item.metadata.limit.context / 1_000_000).toFixed(1).replace('.0', '')}M ctx`
                                                : `${Math.round(item.metadata.limit.context / 1000)}k ctx`}
                                            </span>
                                          )}
                                          {item.metadata?.limit?.output && (
                                            <span className="text-[10px] font-mono bg-sunken text-muted px-1.5 py-0.5 rounded-xs border border-hairline font-normal" title={t('pricing.max_output')}>
                                              {Math.round(item.metadata.limit.output / 1000)}k out
                                            </span>
                                          )}
                                          {item.metadata?.modalities?.input?.map((m: string) => (
                                            <span key={m} className="text-[10px] uppercase font-semibold bg-sunken text-muted px-1.5 py-0.5 rounded-xs border border-hairline">
                                              {m === 'image' ? 'vision' : m}
                                            </span>
                                          ))}
                                        </div>
                                        <div className="flex items-center gap-2 mt-2 pt-1 border-t border-hairline/60 flex-wrap">
                                          <span className="text-[11px] text-muted">
                                            {t('pricing.available_on_providers', { count: item.providers_count })}
                                          </span>
                                          <span className="text-muted/40">•</span>
                                          <button
                                            type="button"
                                            onClick={() => { setSelectedModelForDetails(item); setShowRawJson(false); }}
                                            className="text-[11px] text-muted hover:text-ink hover:underline flex items-center gap-1 cursor-pointer font-medium"
                                          >
                                            <Info size={11} className="text-accent" />
                                            <span>{t('pricing.model_sheet_link')}</span>
                                          </button>
                                          <span className="text-muted/40">•</span>
                                          <button
                                            type="button"
                                            onClick={() => handleOpenModelStats(item.model)}
                                            className="text-[11px] text-muted hover:text-ink hover:underline flex items-center gap-1 cursor-pointer font-medium"
                                          >
                                            <BarChart3 size={11} />
                                            <span>{t('pricing.model_stats_link')}</span>
                                          </button>
                                        </div>
                                      </div>
                                    </td>
                                  ) : null}

                                  <td className="align-middle">
                                    <div className="flex items-center gap-2.5">
                                      {prov.provider_logo_url && (
                                        <img
                                          src={prov.provider_logo_url}
                                          alt={prov.provider}
                                          className="w-4 h-4 object-contain shrink-0"
                                          loading="lazy"
                                          onError={(e) => { (e.currentTarget as HTMLElement).style.display = 'none'; }}
                                        />
                                      )}
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <span className="font-semibold text-xs text-ink">{prov.key_name}</span>
                                        <span className="ds-badge text-[10px]">{prov.provider}</span>
                                        {prov.upstream_model && prov.upstream_model !== item.model && (
                                          <span className="text-[10px] font-mono text-muted bg-sunken px-1 rounded-xs border border-hairline" title="Identificativo upstream inoltrato">
                                            {prov.upstream_model}
                                          </span>
                                        )}
                                        {prov.is_free_tier && (
                                          <span className="ds-badge ds-badge--accent text-[10px]">Free tier</span>
                                        )}
                                      </div>
                                    </div>
                                  </td>

                                  <td className="ds-table__num align-middle text-xs">
                                    {prov.is_free_tier ? '$0.00' : `$${prov.prompt_price_per_1m.toFixed(2)}`}
                                  </td>

                                  <td className="ds-table__num align-middle text-xs">
                                    {prov.is_free_tier ? '$0.00' : `$${prov.completion_price_per_1m.toFixed(2)}`}
                                  </td>

                                  <td className="ds-table__num align-middle">
                                    <div className="flex items-center justify-end gap-1.5">
                                      {testState?.msg && (
                                        <span className={`text-[11px] font-semibold mr-1.5 ${testState.ok ? 'text-ok-text' : 'text-err-text'}`}>
                                          {testState.msg}
                                        </span>
                                      )}
                                      <button
                                        type="button"
                                        className="ds-btn ds-btn--secondary ds-btn--sm text-xs py-0.5"
                                        disabled={testState?.loading}
                                        onClick={() => handleTestCatalogProvider(prov.key_id)}
                                      >
                                        <Zap size={11} className={testState?.loading ? 'animate-spin' : 'text-accent'} />
                                        <span>{t('pricing.btn_test')}</span>
                                      </button>
                                      <button
                                        type="button"
                                        className="ds-btn ds-btn--ghost ds-btn--sm text-xs py-0.5 text-accent"
                                        onClick={() => handleOpenPricingForModel(item.model, prov.provider, prov.key_id)}
                                      >
                                        Tariffa
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </React.Fragment>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Part 2: Regole Tariffarie Personalizzate */}
            <div className="flex flex-col gap-4 mt-4">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                  <h3 className="text-base font-bold text-ink">{t('pricing.custom_rules_title')}</h3>
                  <p className="text-xs text-muted mt-0.5">
                    {t('pricing.custom_rules_desc')}
                  </p>
                </div>
                <button
                  type="button"
                  className="ds-btn ds-btn--primary ds-btn--sm flex items-center gap-1.5"
                  onClick={() => {
                    setEditingPricingId(null);
                    setPricingModalError(null);
                    setNewPricingRule({
                      model: '',
                      provider: '',
                      upstream_key_id: '',
                      capy_key_id: '',
                      prompt_price_per_1m: 0,
                      completion_price_per_1m: 0,
                    });
                    setShowAddPricingModal(true);
                  }}
                >
                  <Plus size={15} />
                  <span>{t('pricing.add_btn')}</span>
                </button>
              </div>

              <div className="p-4 bg-surface border border-hairline rounded-sm flex items-start gap-3 text-xs text-muted leading-relaxed">
                <HelpCircle size={16} className="text-accent shrink-0 mt-0.5" />
                <div>{t('pricing.notice')}</div>
              </div>

              <div className="bg-surface border border-hairline rounded-sm shadow-xs overflow-hidden">
                <div className="ds-table-wrap">
                  <table className="ds-table">
                    <thead>
                      <tr>
                        <th>{t('pricing.col_model')}</th>
                        <th>{t('pricing.col_provider')}</th>
                        <th>{t('pricing.col_specific')}</th>
                        <th className="ds-table__num">{t('pricing.col_input')}</th>
                        <th className="ds-table__num">{t('pricing.col_output')}</th>
                        <th className="ds-table__num">{t('pricing.col_actions')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredPricingRules.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="text-center py-8 text-muted text-xs">
                            {t('pricing.custom_rules_empty')}
                          </td>
                        </tr>
                      ) : (
                        filteredPricingRules.map((r) => (
                          <tr key={r.id}>
                            <td className="font-semibold text-xs text-ink">{r.model}</td>
                            <td>
                              {r.provider ? <span className="ds-badge text-xs">{r.provider}</span> : <span className="text-xs text-muted">{t('modal.pricing.all_providers')}</span>}
                            </td>
                            <td className="text-xs text-muted">
                              {r.capy_key_name || r.upstream_key_name || t('pricing.global')}
                            </td>
                            <td className="ds-table__num text-xs">${r.prompt_price_per_1m.toFixed(2)}</td>
                            <td className="ds-table__num text-xs">${r.completion_price_per_1m.toFixed(2)}</td>
                            <td className="ds-table__num">
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  type="button"
                                  className="ds-btn ds-btn--secondary ds-btn--sm text-xs"
                                  onClick={() => handleOpenEditPricing(r)}
                                >
                                  {t('pricing.action_edit')}
                                </button>
                                <button
                                  type="button"
                                  className="ds-btn ds-btn--ghost ds-btn--sm text-xs text-err-text"
                                  onClick={() => handleDeletePricingRule(r.id)}
                                >
                                  {t('pricing.action_delete')}
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* VIEW 6: LOG DI TRAFFICO */}
        {/* ========================================================================= */}
        {activeTab === 'logs' && (
          <div className="flex flex-col gap-6 animate-in fade-in duration-150">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <h2 className="text-lg font-bold text-ink">{t('logs.title')}</h2>
                <p className="text-xs text-muted mt-0.5">
                  {t('logs.desc')}
                </p>
              </div>

              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-xs text-muted cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={autoRefreshLogs}
                    onChange={(e) => setAutoRefreshLogs(e.target.checked)}
                    className="accent-ink"
                  />
                  <span>{t('logs.live_refresh')}</span>
                </label>
                <button
                  type="button"
                  className="ds-btn ds-btn--secondary ds-btn--sm flex items-center gap-1"
                  onClick={() => loadData()}
                >
                  <RefreshCw size={13} />
                  <span>{t('common.refresh')}</span>
                </button>
              </div>
            </div>

            <div className="bg-surface border border-hairline rounded-sm shadow-xs overflow-hidden">
              <div className="ds-table-wrap">
                <table className="ds-table">
                  <thead>
                    <tr>
                      <th>{t('logs.col_time')}</th>
                      <th>{t('logs.col_app')}</th>
                      <th>{t('modal.provider.provider_label')}</th>
                      <th>{t('logs.col_model')}</th>
                      <th className="ds-table__num">{t('logs.col_tokens')}</th>
                      <th className="ds-table__num">{t('logs.col_latency')}</th>
                      <th className="ds-table__num">{t('logs.col_cost')}</th>
                      <th>{t('logs.col_status')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="text-center py-12 text-muted text-xs">
                          Nessuna richiesta registrata finora.
                        </td>
                      </tr>
                    ) : (
                      logs.map((l) => {
                        const meta = l.adaptation_meta ? (() => { try { return JSON.parse(l.adaptation_meta); } catch { return null; } })() : null;
                        const totalTok = l.total_tokens ?? l.tokens_total ?? 0;
                        const promptTok = l.prompt_tokens ?? l.tokens_prompt ?? 0;
                        const complTok = l.completion_tokens ?? l.tokens_completion ?? 0;
                        const isFree = (l.cost_usd || 0) === 0 || l.upstream_is_free_tier === 1;

                        return (
                          <tr
                            key={l.id}
                            onClick={() => setSelectedLogForDetail(l)}
                            className="cursor-pointer hover:bg-sunken/80 transition-colors group border-b border-hairline"
                            title="Visualizza dettaglio chiamata"
                          >
                            <td className="text-xs text-muted whitespace-nowrap font-mono">
                              {new Date(l.created_at).toLocaleTimeString()}
                            </td>
                            <td className="font-semibold text-xs text-ink">
                              {l.virtual_key_name || 'Admin'}
                            </td>
                            <td className="text-xs text-ink">
                              <div className="flex items-center gap-1.5">
                                <Server size={12} className="text-muted shrink-0" />
                                <span className="font-medium">{l.provider}</span>
                              </div>
                            </td>
                            <td className="text-xs text-ink">
                              <span className="font-mono text-xs font-medium group-hover:text-accent transition-colors">{l.model}</span>
                            </td>
                            <td className="ds-table__num text-xs">
                              <span className="font-mono font-medium">{totalTok.toLocaleString()}</span>
                              <span className="text-[11px] text-muted ml-1 font-mono">
                                ({promptTok.toLocaleString()} in / {complTok.toLocaleString()} out)
                              </span>
                            </td>
                            <td className="ds-table__num text-xs font-mono">
                              {l.latency_ms}ms
                              {l.ttft_ms ? <span className="text-muted text-[10px]"> ({l.ttft_ms}ms TTFT)</span> : null}
                            </td>
                            <td className="ds-table__num text-xs font-mono font-medium text-ink">
                              {isFree ? (
                                <span className="text-muted">
                                  $0.00000
                                  <span className="text-[10px] bg-sunken px-1 py-0.5 rounded border border-hairline ml-1 font-sans text-muted" title={t('logs.detail_cost_explanation_free')}>
                                    Free
                                  </span>
                                </span>
                              ) : (
                                `$${(l.cost_usd || 0).toFixed(5)}`
                              )}
                            </td>
                            <td>
                              <div className="flex items-center justify-between gap-1">
                                {l.status_code >= 200 && l.status_code < 300 ? (
                                  <span className="ds-badge ds-badge--ok text-xs font-mono">{l.status_code}</span>
                                ) : l.status_code === 429 ? (
                                  <span className="ds-badge ds-badge--warn text-xs font-mono">429</span>
                                ) : (
                                  <span className="ds-badge ds-badge--err text-xs font-mono">{l.status_code || 'ERR'}</span>
                                )}
                                <span className="text-muted text-[10px] opacity-0 group-hover:opacity-100 transition-opacity">
                                  →
                                </span>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ========================================================================= */}
      {/* MODAL: DETTAGLIO CHIAMATA E SPIEGAZIONE ADATTAMENTO */}
      {/* ========================================================================= */}
      {selectedLogForDetail && (() => {
        const l = selectedLogForDetail;
        const meta = l.adaptation_meta ? (() => { try { return JSON.parse(l.adaptation_meta); } catch { return null; } })() : null;
        const totalTok = l.total_tokens ?? l.tokens_total ?? 0;
        const promptTok = l.prompt_tokens ?? l.tokens_prompt ?? 0;
        const complTok = l.completion_tokens ?? l.tokens_completion ?? 0;
        const isFree = (l.cost_usd || 0) === 0 || l.upstream_is_free_tier === 1;

        const origParams = meta?.original_params || {};
        const adaptParams = meta?.adapted_params || {};
        const allParamKeys = Array.from(new Set([...Object.keys(origParams), ...Object.keys(adaptParams)]));

        return (
          <div
            className="fixed inset-0 bg-scrim flex items-center justify-center p-4 z-50 animate-in fade-in duration-150"
            onClick={(e) => { if (e.target === e.currentTarget) setSelectedLogForDetail(null); }}
          >
            <div className="ds-card shadow-float w-full max-w-4xl flex flex-col gap-5 p-6 border border-hairline max-h-[90vh] overflow-y-auto">
              {/* Header */}
              <div className="flex justify-between items-start border-b border-hairline pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className={`ds-badge text-xs font-semibold font-mono ${l.status_code >= 200 && l.status_code < 300 ? 'ds-badge--ok' : l.status_code === 429 ? 'ds-badge--warn' : 'ds-badge--err'}`}>
                      HTTP {l.status_code}
                    </span>
                    <h3 className="text-lg font-bold text-ink">{t('logs.detail_title')}</h3>
                  </div>
                  <p className="text-xs text-muted mt-0.5">{t('logs.detail_subtitle')}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedLogForDetail(null)}
                  className="text-muted hover:text-ink font-bold p-1 cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Error Message if present on log */}
              {l.error_message && (
                <div className="p-3 bg-err/10 border border-err/30 rounded-sm text-xs text-err font-mono">
                  <strong>Error:</strong> {l.error_message}
                </div>
              )}

              {/* Overview Details List */}
              <div className="bg-sunken border border-hairline rounded-sm p-4 flex flex-col gap-2 text-xs">
                <div className="flex justify-between items-center py-1 border-b border-hairline/60">
                  <span className="text-muted">{t('logs.col_time')}</span>
                  <span className="font-mono text-ink">{new Date(l.created_at).toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-hairline/60">
                  <span className="text-muted">{t('logs.col_app')}</span>
                  <span className="font-semibold text-ink">{l.virtual_key_name || 'Admin'}</span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-hairline/60">
                  <span className="text-muted">{t('modal.provider.provider_label')}</span>
                  <span className="font-medium text-ink">{l.provider} {l.upstream_key_name ? `(${l.upstream_key_name})` : ''}</span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-hairline/60">
                  <span className="text-muted">{t('logs.col_model')}</span>
                  <span className="font-mono font-medium text-ink">
                    {l.model}
                    {meta?.target_model && meta.target_model !== l.model ? ` → ${meta.target_model}` : ''}
                  </span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-hairline/60">
                  <span className="text-muted">{t('logs.col_tokens')}</span>
                  <span className="font-mono text-ink">
                    {totalTok.toLocaleString()} ({promptTok.toLocaleString()} in / {complTok.toLocaleString()} out{meta?.reasoning_tokens ? `, ${meta.reasoning_tokens.toLocaleString()} reasoning` : ''})
                  </span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-hairline/60">
                  <span className="text-muted">{t('logs.col_latency')}</span>
                  <span className="font-mono text-ink">{l.latency_ms}ms {l.ttft_ms ? `(${l.ttft_ms}ms TTFT)` : ''}</span>
                </div>
                <div className="flex justify-between items-center py-1">
                  <span className="text-muted">{t('logs.col_cost')}</span>
                  <span className="font-mono text-ink font-semibold">
                    {isFree ? '$0.00000 (Free)' : `$${(l.cost_usd || 0).toFixed(5)}`}
                  </span>
                </div>
              </div>

              {/* Request Parameters Section */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs uppercase tracking-wider font-semibold text-muted">
                    {t('logs.detail_params_title')}
                  </h4>
                </div>

                {meta && meta.transformations && meta.transformations.length > 0 && (
                  <div className="p-3 bg-sunken rounded-sm border border-hairline flex flex-col gap-1.5">
                    <span className="text-xs font-semibold text-ink flex items-center gap-1.5">
                      <Sliders size={13} className="text-muted" /> {t('logs.detail_transformations')}:
                    </span>
                    <ul className="flex flex-col gap-1 text-xs text-ink/90 pl-1">
                      {meta.transformations.map((tr: string, idx: number) => (
                        <li key={idx} className="flex items-start gap-2">
                          <span className="text-muted font-mono">•</span>
                          <span>{tr}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* Parameters Comparison Table */}
              {allParamKeys.length > 0 && (
                <div className="flex flex-col gap-2">
                  <div className="bg-sunken border border-hairline rounded-sm overflow-hidden text-xs">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-hairline bg-surface/50 text-[11px] text-muted font-semibold">
                          <th className="p-2.5">{t('logs.detail_param_name')}</th>
                          <th className="p-2.5">{t('logs.detail_param_client')}</th>
                          <th className="p-2.5">{t('logs.detail_param_upstream')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-hairline font-mono text-[11px]">
                        {allParamKeys.map((key) => {
                          const clientVal = origParams[key];
                          const upVal = adaptParams[key];
                          const isRemoved = clientVal !== undefined && upVal === undefined;
                          const isChanged = clientVal !== undefined && upVal !== undefined && JSON.stringify(clientVal) !== JSON.stringify(upVal);

                          return (
                            <tr key={key} className={isRemoved ? 'bg-err/5' : isChanged ? 'bg-accent/5' : ''}>
                              <td className="p-2.5 font-sans font-semibold text-ink">
                                {key}
                              </td>
                              <td className="p-2.5 text-ink">
                                {clientVal !== undefined ? (
                                  typeof clientVal === 'object' ? JSON.stringify(clientVal) : String(clientVal)
                                ) : (
                                  <span className="text-muted font-sans italic">—</span>
                                )}
                              </td>
                              <td className="p-2.5">
                                {isRemoved ? (
                                  <span className="text-err font-sans font-medium flex items-center gap-1">
                                    {t('logs.detail_param_stripped')}
                                  </span>
                                ) : upVal !== undefined ? (
                                  <span className={isChanged ? 'text-accent font-semibold' : 'text-ink'}>
                                    {typeof upVal === 'object' ? JSON.stringify(upVal) : String(upVal)}
                                  </span>
                                ) : (
                                  <span className="text-muted font-sans italic">—</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Failover History if present */}
              {meta?.failover_history && meta.failover_history.length > 0 && (
                <div className="flex flex-col gap-2">
                  <h4 className="text-xs uppercase tracking-wider font-semibold text-err">
                    {t('logs.detail_failover_section')}
                  </h4>
                  <div className="p-3 bg-err/5 border border-err/20 rounded-sm flex flex-col gap-2 text-xs">
                    {meta.failover_history.map((f: any, idx: number) => (
                      <div key={idx} className="flex items-center justify-between text-xs border-b border-err/10 pb-1.5 last:border-b-0 last:pb-0">
                        <div className="flex items-center gap-2">
                          <span className="ds-badge ds-badge--warn text-[10px] font-mono">
                            #{idx + 1}
                          </span>
                          <span className="font-semibold text-ink">{f.provider} / {f.model}</span>
                        </div>
                        <div className="text-err font-mono text-[11px]">
                          HTTP {f.status} {f.error ? `(${f.error})` : ''}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Output Preview if available */}
              {meta?.output_preview && (
                <div className="flex flex-col gap-2">
                  <h4 className="text-xs uppercase tracking-wider font-semibold text-muted">
                    {t('logs.detail_output_title')}
                  </h4>
                  <div className="p-3.5 bg-sunken rounded-sm border border-hairline font-mono text-xs text-ink max-h-48 overflow-y-auto whitespace-pre-wrap leading-relaxed select-text">
                    {meta.output_preview}
                  </div>
                </div>
              )}

              {/* Vertically Stacked Raw JSON Payloads */}
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs uppercase tracking-wider font-semibold text-muted">
                    Payload grezzi (JSON)
                  </h4>
                  <button
                    type="button"
                    onClick={() => {
                      try {
                        const fullData = {
                          ...l,
                          adaptation_meta: meta,
                        };
                        navigator.clipboard.writeText(JSON.stringify(fullData, null, 2));
                        setCopiedLogJson(true);
                        setTimeout(() => setCopiedLogJson(false), 2000);
                      } catch {}
                    }}
                    className="ds-btn ds-btn--secondary ds-btn--sm flex items-center gap-1.5 py-1 px-2.5 text-xs cursor-pointer"
                  >
                    {copiedLogJson ? (
                      <>
                        <Check size={12} className="text-ok" />
                        <span className="text-ok font-medium">{t('logs.detail_copied')}</span>
                      </>
                    ) : (
                      <>
                        <Copy size={12} />
                        <span>{t('logs.detail_copy_json')}</span>
                      </>
                    )}
                  </button>
                </div>

                {/* 1. Request sent to CapyLLM (Client) */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold text-muted">
                    {t('logs.detail_json_client')}
                  </span>
                  <pre className="p-3 bg-sunken rounded-sm border border-hairline font-mono text-[11px] text-ink overflow-x-auto max-h-52 leading-relaxed select-text">
                    {JSON.stringify({
                      model: l.model,
                      messages: meta?.original_params?.messages || [{ role: 'user', content: '...' }],
                      ...(meta?.original_params || {}),
                    }, null, 2)}
                  </pre>
                </div>

                {/* 2. Response received from provider (Upstream) - Stacked vertically */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold text-muted">
                    {t('logs.detail_json_upstream')}
                  </span>
                  <pre className="p-3 bg-sunken rounded-sm border border-hairline font-mono text-[11px] text-ink overflow-x-auto max-h-52 leading-relaxed select-text">
                    {JSON.stringify(
                      l.status_code >= 400
                        ? {
                            error: {
                              message: l.error_message || 'Upstream error',
                              status: l.status_code,
                            },
                          }
                        : {
                            model: meta?.target_model || l.model,
                            provider: l.provider,
                            ...(meta?.output_preview ? { output: meta.output_preview } : {}),
                            usage: {
                              prompt_tokens: promptTok,
                              completion_tokens: complTok,
                              total_tokens: totalTok,
                            },
                          },
                      null,
                      2
                    )}
                  </pre>
                </div>
              </div>

              {/* Footer */}
              <div className="flex justify-end pt-2 border-t border-hairline">
                <button
                  type="button"
                  className="ds-btn ds-btn--secondary ds-btn--sm"
                  onClick={() => setSelectedLogForDetail(null)}
                >
                  {t('common.close')}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ========================================================================= */}
      {/* MODAL: INFORMAZIONI E LICENZA */}
      {/* ========================================================================= */}
      {showAboutModal && (
        <div className="fixed inset-0 bg-scrim flex items-center justify-center p-4 z-50 animate-in fade-in duration-150" onClick={(e) => { if (e.target === e.currentTarget) setShowAboutModal(false); }}>
          <div className="ds-card shadow-float w-full max-w-lg flex flex-col gap-5 p-6 border border-hairline max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-start">
              <div className="flex items-center gap-3">
                <CapyLogo size={44} className="rounded-lg shadow-sm border border-hairline" />
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-bold text-ink">CapyLLM</h3>
                    <span className="ds-badge ds-badge--accent text-xs">v1.0.0</span>
                  </div>
                  <p className="text-xs text-muted">{t('about.subtitle')}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowAboutModal(false)}
                className="text-muted hover:text-ink font-bold p-1 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-4 bg-sunken rounded-sm border border-hairline flex flex-col gap-2.5 text-xs leading-relaxed">
              <div>
                <span className="font-semibold text-ink">{t('about.author_label')}:</span>
                <span className="ml-1.5 text-ink">{t('about.author_name')}</span>
              </div>
              <div>
                <span className="font-semibold text-ink">Copyright:</span>
                <span className="ml-1.5 text-muted">© 2026 Giacomo Berti</span>
              </div>
              <div>
                <span className="font-semibold text-ink">{t('about.license_label')}:</span>
                <span className="ml-1.5 font-bold text-accent">{t('about.license_name')}</span>
                <p className="mt-1 text-muted">
                  {t('about.description')}
                </p>
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t border-hairline">
              <button
                type="button"
                className="ds-btn ds-btn--primary ds-btn--sm"
                onClick={() => setShowAboutModal(false)}
              >
                {t('about.close')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: IMPOSTAZIONI (CENTRO DI CONTROLLO) */}
      {/* ========================================================================= */}
      {showSettingsModal && (
        <div className="fixed inset-0 bg-scrim flex items-center justify-center p-4 z-50 animate-in fade-in duration-150" onClick={(e) => { if (e.target === e.currentTarget) setShowSettingsModal(false); }}>
          <div className="ds-card shadow-float w-full max-w-xl flex flex-col gap-4 max-h-[90vh] overflow-y-auto border border-hairline">
            <div className="flex justify-between items-center border-b border-hairline pb-3">
              <div className="flex items-center gap-2.5">
                <Settings size={18} className="text-accent" />
                <div>
                  <h3 className="text-base font-bold text-ink">{t('settings.title')}</h3>
                  <p className="text-xs text-muted">{t('settings.subtitle')}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowSettingsModal(false)}
                className="text-muted hover:text-ink p-1 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Tabs inside Settings */}
            <div className="flex items-center gap-2 border-b border-hairline pb-2 overflow-x-auto">
              <button
                type="button"
                className={`px-3 py-1.5 text-xs font-semibold rounded-sm transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${settingsTab === 'telegram' ? 'bg-accent text-white' : 'bg-surface text-muted hover:text-ink'}`}
                onClick={() => setSettingsTab('telegram')}
              >
                <Bell size={13} />
                <span>{t('settings.tab_telegram')}</span>
              </button>
              <button
                type="button"
                className={`px-3 py-1.5 text-xs font-semibold rounded-sm transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${settingsTab === 'reset' ? 'bg-accent text-white' : 'bg-surface text-muted hover:text-ink'}`}
                onClick={() => {
                  setSettingsTab('reset');
                  loadSystemSettings();
                }}
              >
                <Clock size={13} />
                <span>{t('settings.tab_reset_limits')}</span>
              </button>
              <button
                type="button"
                className={`px-3 py-1.5 text-xs font-semibold rounded-sm transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${settingsTab === 'security' ? 'bg-accent text-white' : 'bg-surface text-muted hover:text-ink'}`}
                onClick={() => setSettingsTab('security')}
              >
                <Shield size={13} />
                <span>{t('settings.tab_security')}</span>
              </button>
              <button
                type="button"
                className={`px-3 py-1.5 text-xs font-semibold rounded-sm transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${settingsTab === 'database' ? 'bg-accent text-white' : 'bg-surface text-muted hover:text-ink'}`}
                onClick={() => setSettingsTab('database')}
              >
                <Database size={13} />
                <span>{t('settings.tab_database')}</span>
              </button>
            </div>

            {/* Tab: Telegram */}
            {settingsTab === 'telegram' && (
              <form onSubmit={handleSaveTelegram} className="flex flex-col gap-4">
                {telegramTestNotice && (
                  <div className={`p-2.5 rounded-sm text-xs ${telegramTestNotice.ok ? 'bg-ok-wash text-ok-text border border-ok-line' : 'bg-err-wash text-err-text border border-err-line'}`}>
                    {telegramTestNotice.msg}
                  </div>
                )}

                <div className="p-3 bg-sunken rounded-sm border border-hairline flex items-center justify-between">
                  <div>
                    <div className="font-semibold text-xs text-ink">{t('settings.telegram_enable')}</div>
                    <div className="text-xs text-muted">{t('settings.telegram_enable_desc')}</div>
                  </div>
                  <input
                    type="checkbox"
                    id="tg_enable"
                    checked={telegramForm.is_enabled}
                    onChange={(e) => setTelegramForm({ ...telegramForm, is_enabled: e.target.checked })}
                    className="accent-ink w-4 h-4 cursor-pointer"
                  />
                </div>

                <div className="ds-field">
                  <label className="ds-label">{t('settings.telegram_bot_token')}</label>
                  <input
                    type="password"
                    placeholder={telegramConfig?.has_bot_token ? '•••••••••••• (Configurato)' : 'es. 123456789:ABCdefGHI...'}
                    value={telegramForm.bot_token}
                    onChange={(e) => setTelegramForm({ ...telegramForm, bot_token: e.target.value })}
                    className="ds-input text-xs"
                  />
                  <span className="text-[11px] text-muted">{t('settings.telegram_bot_hint')}</span>
                </div>

                <div className="ds-field">
                  <label className="ds-label">{t('settings.telegram_chat_id')}</label>
                  <input
                    type="text"
                    required={telegramForm.is_enabled}
                    placeholder="es. 123456789"
                    value={telegramForm.chat_id}
                    onChange={(e) => setTelegramForm({ ...telegramForm, chat_id: e.target.value })}
                    className="ds-input text-xs"
                  />
                </div>

                <div className="flex justify-between items-center pt-3 border-t border-hairline">
                  <button
                    type="button"
                    className="ds-btn ds-btn--secondary ds-btn--sm flex items-center gap-1.5"
                    onClick={handleTestTelegram}
                    disabled={telegramTesting || (!telegramForm.chat_id && !telegramConfig?.chat_id)}
                  >
                    <Zap size={14} className={telegramTesting ? 'animate-spin' : 'text-accent'} />
                    <span>{telegramTesting ? t('settings.telegram_sending') : t('settings.telegram_test')}</span>
                  </button>

                  <button type="submit" className="ds-btn ds-btn--primary ds-btn--sm">
                    {t('common.save')}
                  </button>
                </div>
              </form>
            )}

            {/* Tab: Limiti & Reset */}
            {settingsTab === 'reset' && (
              <div className="flex flex-col gap-4 text-xs">
                {resetHourNotice && (
                  <div className={`p-2.5 rounded-sm text-xs ${resetHourNotice.ok ? 'bg-ok-wash text-ok-text border border-ok-line' : 'bg-err-wash text-err-text border border-err-line'}`}>
                    {resetHourNotice.msg}
                  </div>
                )}

                <div>
                  <h4 className="font-semibold text-ink text-sm">{t('settings.reset_title')}</h4>
                  <p className="text-muted text-xs mt-0.5">{t('settings.reset_subtitle')}</p>
                </div>

                <div className="p-3 bg-sunken rounded-sm border border-hairline flex items-center justify-between">
                  <div>
                    <div className="text-[11px] text-muted font-medium uppercase tracking-wider">{t('settings.server_time_label')}</div>
                    <div className="font-mono text-lg font-bold text-ink mt-0.5">
                      {systemSettings?.server_time_formatted || (systemSettings?.server_time ? new Date(systemSettings.server_time).toLocaleTimeString([], { hour12: false }) : '--:--:--')}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[11px] text-muted font-medium uppercase tracking-wider">{t('settings.server_timezone_label')}</div>
                    <div className="ds-badge text-xs font-mono font-medium mt-1">
                      {systemSettings?.server_timezone || 'UTC'}
                      {systemSettings?.server_timezone_offset !== undefined ? ` (UTC${systemSettings.server_timezone_offset >= 0 ? '+' : ''}${systemSettings.server_timezone_offset})` : ''}
                    </div>
                  </div>
                </div>

                <div className="ds-field flex flex-col gap-1.5">
                  <label htmlFor="settings-daily-reset-hour" className="ds-label">
                    {t('settings.reset_hour_label')}
                  </label>
                  <select
                    id="settings-daily-reset-hour"
                    value={selectedResetHour}
                    onChange={(e) => setSelectedResetHour(Number(e.target.value))}
                    className="ds-input text-xs"
                  >
                    {Array.from({ length: 24 }).map((_, i) => {
                      const hh = String(i).padStart(2, '0');
                      const label =
                        i === 0
                          ? `${hh}:00 - ${t('settings.reset_hour_midnight')}`
                          : i === 12
                          ? `${hh}:00 - ${t('settings.reset_hour_noon')}`
                          : `${hh}:00`;
                      return (
                        <option key={i} value={i}>
                          {label}
                        </option>
                      );
                    })}
                  </select>
                  <span className="text-[11px] text-muted leading-relaxed">
                    {t('settings.reset_hour_desc')}
                  </span>
                </div>

                <div className="flex justify-end pt-3 border-t border-hairline">
                  <button
                    type="button"
                    disabled={savingResetHour}
                    onClick={handleSaveResetHour}
                    className="ds-btn ds-btn--primary ds-btn--sm"
                  >
                    {savingResetHour ? t('common.saving') : t('common.save')}
                  </button>
                </div>
              </div>
            )}

            {/* Tab: Security */}
            {settingsTab === 'security' && (
              <div className="flex flex-col gap-4 text-xs">
                <div className="p-3.5 bg-sunken rounded-sm border border-hairline flex flex-col gap-1.5">
                  <div className="font-semibold text-ink text-sm flex items-center gap-2">
                    <Lock size={15} className="text-accent" />
                    <span>{t('settings.security_passkey_title')}</span>
                  </div>
                  <p className="text-muted leading-relaxed">
                    {t('settings.security_passkey_desc')}
                  </p>
                </div>

                <div className="p-3.5 bg-sunken rounded-sm border border-hairline flex flex-col gap-1.5">
                  <div className="font-semibold text-ink text-sm flex items-center gap-2">
                    <Shield size={15} className="text-accent" />
                    <span>{t('settings.security_crypto_title')}</span>
                  </div>
                  <p className="text-muted leading-relaxed">
                    {t('settings.security_crypto_desc')}
                  </p>
                </div>
              </div>
            )}

            {/* Tab: Database */}
            {settingsTab === 'database' && (
              <div className="flex flex-col gap-4 text-xs">
                <div className="p-3.5 bg-sunken rounded-sm border border-hairline flex justify-between items-center">
                  <div>
                    <div className="font-semibold text-ink text-sm">{t('settings.db_backup_title')}</div>
                    <div className="text-muted text-xs">{t('settings.db_backup_desc')}</div>
                  </div>
                  <a
                    href="/api/admin/system/backup"
                    download
                    className="ds-btn ds-btn--secondary ds-btn--sm flex items-center gap-1.5"
                  >
                    <Download size={14} className="text-accent" />
                    <span>{t('settings.db_backup_action')}</span>
                  </a>
                </div>

                <div className="p-3.5 bg-sunken rounded-sm border border-hairline flex flex-col gap-2">
                  <div className="font-semibold text-ink text-sm">{t('settings.db_logs_title')}</div>
                  <p className="text-muted">{t('settings.db_logs_desc')}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <button
                      type="button"
                      className="ds-btn ds-btn--secondary ds-btn--sm text-xs"
                      disabled={clearingLogs}
                      onClick={() => handleClearLogs(7)}
                    >
                      {t('settings.db_logs_older_7d')}
                    </button>
                    <button
                      type="button"
                      className="ds-btn ds-btn--ghost ds-btn--sm text-xs text-err-text"
                      disabled={clearingLogs}
                      onClick={() => handleClearLogs(0)}
                    >
                      {t('settings.db_logs_clear_all')}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: AGGIUNGI FORNITORE (CON SCHEMA API & SCHEMA PERSONALIZZATO) */}
      {/* ========================================================================= */}
      {showAddKeyModal && (
        <div className="fixed inset-0 bg-scrim flex items-center justify-center p-4 z-50 animate-in fade-in duration-150" onClick={(e) => { if (e.target === e.currentTarget) setShowAddKeyModal(false); }}>
          <div className="ds-card shadow-float w-full max-w-2xl flex flex-col gap-5 p-6 border border-hairline max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-hairline pb-3">
              <div>
                <h3 className="text-base font-bold text-ink">{editingKeyId ? t('modal.provider.title_edit') : t('modal.provider.title')}</h3>
                <p className="text-xs text-muted mt-0.5">{t('modal.provider.subtitle')}</p>
              </div>
              <button type="button" onClick={() => setShowAddKeyModal(false)} className="text-muted hover:text-ink cursor-pointer p-1 rounded-sm hover:bg-sunken"><X size={16} /></button>
            </div>

            {keyModalError && (
              <div className="p-3 bg-err-wash text-err-text border border-err-line rounded-sm text-xs flex items-center gap-2">
                <AlertTriangle size={14} className="shrink-0" />
                <span>{keyModalError}</span>
              </div>
            )}

            <form onSubmit={handleCreateUpstreamKey} className="flex flex-col gap-4">
              {/* Row 1: Searchable Provider & API Key */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div className="ds-field relative">
                  <label className="ds-label">{t('modal.provider.provider_label')}</label>
                  <div className="relative">
                    <input
                      type="text"
                      placeholder={t('modal.provider.search_placeholder')}
                      value={providerSearchTerm}
                      onChange={(e) => {
                        setProviderSearchTerm(e.target.value);
                        setIsProviderDropdownOpen(true);
                      }}
                      onFocus={() => setIsProviderDropdownOpen(true)}
                      className="ds-input text-xs"
                    />
                    {isProviderDropdownOpen && (
                      <div className="absolute left-0 right-0 top-full mt-1 bg-surface border border-hairline rounded-sm shadow-float max-h-56 overflow-y-auto z-50">
                        {filteredProviders.length === 0 ? (
                          <div className="p-2.5 text-xs text-muted">Nessun fornitore trovato</div>
                        ) : (
                          filteredProviders.map((p: any) => (
                            <div
                              key={p.id}
                              onClick={() => {
                                handleProviderSelect(p.id);
                                setProviderSearchTerm(p.name || p.id);
                                setIsProviderDropdownOpen(false);
                              }}
                              className="p-2 text-xs hover:bg-sunken cursor-pointer flex items-center justify-between border-b border-hairline last:border-b-0"
                            >
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-ink">{p.name}</span>
                                <span className="text-[10px] font-mono text-muted">({p.id})</span>
                              </div>
                              {p.is_preset && (
                                <span className="text-[10px] text-accent font-medium">Curato</span>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="ds-field">
                  <label className="ds-label">
                    {t('modal.provider.key_label')} {editingKeyId && <span className="text-[10px] text-muted font-normal lowercase">{t('modal.provider.key_edit_hint')}</span>}
                  </label>
                  <input
                    type="password"
                    required={!editingKeyId}
                    placeholder={editingKeyId ? '••••••••••••••••' : t('modal.provider.key_placeholder')}
                    value={newKey.api_key}
                    onChange={(e) => setNewKey({ ...newKey, api_key: e.target.value })}
                    className="ds-input text-xs font-mono"
                  />
                </div>
              </div>

              {/* Row 2: Name & Usage Limit */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div className="ds-field">
                  <label className="ds-label">{t('modal.provider.name_label')}</label>
                  <input
                    type="text"
                    required
                    placeholder={t('modal.provider.name_placeholder')}
                    value={newKey.name}
                    onChange={(e) => setNewKey({ ...newKey, name: e.target.value })}
                    className="ds-input text-xs"
                  />
                </div>

                <BudgetLimitControl
                  idPrefix="modal-provider-budget"
                  limit={newKey.budget_limit}
                  type={newKey.budget_type}
                  cadence={newKey.budget_cadence}
                  onChange={({ limit, type, cadence }) =>
                    setNewKey({
                      ...newKey,
                      budget_limit: limit,
                      budget_type: type,
                      budget_cadence: cadence,
                      daily_token_limit: type === 'tokens' ? Math.floor(limit) : 0,
                    })
                  }
                />
              </div>

              {/* Row 3: Base Endpoint & Free Tier Checkbox */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 items-center">
                <div className="ds-field">
                  <label className="ds-label">
                    {t('modal.provider.base_url_label')}
                  </label>
                  <input
                    type="url"
                    required
                    placeholder="https://api.openai.com/v1"
                    value={newKey.base_url}
                    onChange={(e) => setNewKey({ ...newKey, base_url: e.target.value })}
                    className="ds-input text-xs font-mono"
                  />
                </div>

                <div className="flex items-center gap-2 pt-4 sm:pt-5">
                  <input
                    type="checkbox"
                    id="key_free_tier"
                    checked={newKey.is_free_tier}
                    onChange={(e) => setNewKey({ ...newKey, is_free_tier: e.target.checked })}
                    className="accent-ink cursor-pointer w-4 h-4"
                  />
                  <label htmlFor="key_free_tier" className="text-xs text-ink cursor-pointer select-none font-medium">
                    {t('modal.provider.free_tier')}
                  </label>
                </div>
              </div>

              {/* Advanced Schema options toggle */}
              <div className="border-t border-hairline pt-2">
                <button
                  type="button"
                  className="text-xs text-muted hover:text-ink flex items-center gap-1 cursor-pointer"
                  onClick={() => setShowAdvancedKeyOptions(!showAdvancedKeyOptions)}
                >
                  {showAdvancedKeyOptions ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                  <span>{t('modal.provider.advanced_toggle')}</span>
                </button>
              </div>

              {showAdvancedKeyOptions && (
                <div className="flex flex-col gap-3 p-3 bg-sunken rounded-sm border border-hairline">
                  {/* Multi-API Schema Selector */}
                  <div className="ds-field">
                    <div className="flex justify-between items-center mb-1">
                      <label className="ds-label mb-0">{t('modal.provider.supported_schemas_label')}</label>
                      <button
                        type="button"
                        className="text-xs text-accent hover:underline cursor-pointer"
                        onClick={() => toggleKeySchema('*')}
                      >
                        {t('modal.provider.all_schemas')}
                      </button>
                    </div>
                    <div className="p-2 bg-surface rounded-sm border border-hairline flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() => toggleKeySchema('*')}
                        className={`px-2.5 py-1 text-xs rounded-xs border cursor-pointer transition-colors ${
                          newKey.supported_schemas.includes('*')
                            ? 'bg-ink text-canvas font-medium border-ink'
                            : 'bg-surface text-muted hover:text-ink border-hairline'
                        }`}
                      >
                        {t('modal.provider.all_schemas')}
                      </button>
                      {[
                        { id: 'chat_completions', label: t('modal.provider.schema_chat_short') },
                        { id: 'responses', label: t('modal.provider.schema_responses_short') },
                        { id: 'embeddings', label: t('modal.provider.schema_embeddings_short') },
                        { id: 'decision', label: t('modal.provider.schema_decision_short') },
                        { id: 'custom', label: t('modal.provider.schema_custom_short') },
                      ].map((s) => {
                        const isSelected = newKey.supported_schemas.includes('*') || newKey.supported_schemas.includes(s.id);
                        return (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => toggleKeySchema(s.id)}
                            className={`px-2.5 py-1 text-xs rounded-xs border cursor-pointer transition-colors ${
                              isSelected
                                ? 'bg-accent text-white font-medium border-accent'
                                : 'bg-surface text-ink hover:border-accent border-hairline'
                            }`}
                          >
                            {s.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Custom JSON Schema Config Area */}
                  {(newKey.supported_schemas.includes('custom') || newKey.api_schema === 'custom') && (
                    <div className="ds-field">
                      <label className="ds-label">{t('modal.provider.custom_schema_label')}</label>
                      <textarea
                        rows={3}
                        placeholder={t('modal.provider.custom_schema_placeholder')}
                        value={newKey.custom_schema_config}
                        onChange={(e) => setNewKey({ ...newKey, custom_schema_config: e.target.value })}
                        className="ds-input text-xs font-mono"
                      />
                      <span className="text-[11px] text-muted mt-1 block">
                        {t('modal.provider.custom_schema_hint')}
                      </span>
                    </div>
                  )}
                </div>
              )}

              <div className="flex justify-end gap-2 mt-2 pt-2 border-t border-hairline">
                <button
                  type="button"
                  className="ds-btn ds-btn--secondary"
                  disabled={keyModalSubmitting}
                  onClick={() => setShowAddKeyModal(false)}
                >
                  {t('modal.provider.cancel')}
                </button>
                <button
                  type="submit"
                  className="ds-btn ds-btn--primary"
                  disabled={keyModalSubmitting}
                >
                  {keyModalSubmitting ? t('modal.provider.submitting') : (editingKeyId ? t('modal.provider.submit_edit') : t('modal.provider.submit'))}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: STATISTICHE DETTAGLIATE FORNITORE */}
      {/* ========================================================================= */}
      {selectedProviderForStats && (
        <div
          className="fixed inset-0 bg-scrim flex items-center justify-center p-4 z-50 animate-in fade-in duration-150"
          onClick={(e) => { if (e.target === e.currentTarget) setSelectedProviderForStats(null); }}
        >
          <div className="ds-card shadow-float w-full max-w-3xl flex flex-col gap-5 p-6 border border-hairline max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-start border-b border-hairline pb-4">
              <div>
                <h3 className="text-base font-bold text-ink">
                  {t('providers.modal_stats_title')}: <span className="font-mono text-accent">{selectedProviderForStats}</span>
                </h3>
                <p className="text-xs text-muted mt-0.5">
                  {t('providers.modal_stats_models_title')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedProviderForStats(null)}
                className="text-muted hover:text-ink font-bold p-1 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {loadingProviderStats ? (
              <div className="py-12 text-center text-xs text-muted">Caricamento statistiche...</div>
            ) : !providerStatsDetail || !providerStatsDetail.models || providerStatsDetail.models.length === 0 ? (
              <div className="py-12 text-center text-xs text-muted">Nessuna chiamata registrata per questo fornitore.</div>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="ds-table-wrap">
                  <table className="ds-table">
                    <thead>
                      <tr>
                        <th>Modello</th>
                        <th className="ds-table__num">Richieste</th>
                        <th className="ds-table__num">Token</th>
                        <th className="ds-table__num">Latenza</th>
                        <th className="ds-table__num">Velocità</th>
                        <th className="ds-table__num">Costo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {providerStatsDetail.models.map((m: any) => (
                        <tr key={m.model}>
                          <td className="font-mono text-xs font-medium text-ink">{m.model}</td>
                          <td className="ds-table__num font-mono text-xs">{m.requests.toLocaleString()}</td>
                          <td className="ds-table__num font-mono text-xs">{m.total_tokens.toLocaleString()}</td>
                          <td className="ds-table__num font-mono text-xs">{m.avg_latency_ms}ms</td>
                          <td className="ds-table__num font-mono text-xs">{m.tokens_per_sec > 0 ? `${m.tokens_per_sec} tok/s` : '—'}</td>
                          <td className="ds-table__num font-mono text-xs">${(m.cost_usd || 0).toFixed(4)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="flex justify-end pt-3 border-t border-hairline">
              <button
                type="button"
                onClick={() => setSelectedProviderForStats(null)}
                className="ds-btn ds-btn--secondary ds-btn--sm"
              >
                {t('providers.modal_stats_close')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: CREA CAPYKEY (APP CLIENT) */}
      {/* ========================================================================= */}
      {showAddCapyKeyModal && (
        <div className="fixed inset-0 bg-scrim flex items-center justify-center p-4 z-50 animate-in fade-in duration-150" onClick={(e) => { if (e.target === e.currentTarget) setShowAddCapyKeyModal(false); }}>
          <div className="ds-card shadow-float w-full max-w-md flex flex-col gap-4 border border-hairline max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-base font-bold text-ink">{editingCapyKeyId ? t('modal.capykey.title_edit') : t('modal.capykey.title')}</h3>
                <p className="text-xs text-muted">{t('modal.capykey.subtitle')}</p>
              </div>
              <button type="button" onClick={() => setShowAddCapyKeyModal(false)} className="text-muted hover:text-ink cursor-pointer p-1 rounded-sm hover:bg-sunken"><X size={16} /></button>
            </div>

            {capyKeyModalError && (
              <div className="p-3 bg-err-wash text-err-text border border-err-line rounded-sm text-xs flex items-center gap-2">
                <AlertTriangle size={14} className="shrink-0" />
                <span>{capyKeyModalError}</span>
              </div>
            )}

            <form onSubmit={handleCreateCapyKey} className="flex flex-col gap-3.5">
              <div className="ds-field">
                <label className="ds-label">{t('modal.capykey.name_label')}</label>
                <input
                  type="text"
                  required
                  placeholder={t('modal.capykey.name_placeholder')}
                  value={newCapyKey.name}
                  onChange={(e) => setNewCapyKey({ ...newCapyKey, name: e.target.value })}
                  className="ds-input text-xs"
                />
              </div>

              {/* Pool Assignment Dropdown */}
              <div className="ds-field">
                <label className="ds-label">{t('modal.capykey.pool_label')}</label>
                {pools.length === 0 ? (
                  <div className="p-2.5 bg-sunken border border-hairline rounded-sm text-xs text-muted flex items-center justify-between">
                    <span>{t('modal.capykey.no_pools')}</span>
                    <button
                      type="button"
                      className="text-xs text-accent underline cursor-pointer"
                      onClick={() => {
                        setShowAddCapyKeyModal(false);
                        setShowAddPoolModal(true);
                      }}
                    >
                      {t('modal.capykey.create_pool_now')}
                    </button>
                  </div>
                ) : (
                  <select
                    value={newCapyKey.pool_id}
                    onChange={(e) => {
                      const pid = e.target.value;
                      setNewCapyKey({ ...newCapyKey, pool_id: pid });
                      setSelectedModelPills(['*']);
                    }}
                    className="ds-input text-xs"
                    required
                  >
                    <option value="">{t('modal.capykey.select_pool')}</option>
                    {pools.map((p) => (
                      <option key={p.id} value={p.id}>{p.name} ({p.id})</option>
                    ))}
                  </select>
                )}
              </div>

              <BudgetLimitControl
                idPrefix="modal-capykey-budget"
                limit={newCapyKey.budget_limit}
                type={newCapyKey.budget_type}
                cadence={newCapyKey.budget_cadence}
                onChange={({ limit, type, cadence }) =>
                  setNewCapyKey({
                    ...newCapyKey,
                    budget_limit: limit,
                    budget_type: type,
                    budget_cadence: cadence,
                  })
                }
              />

              {/* Advanced options for CapyKey */}
              <div className="border-t border-hairline pt-2">
                <button
                  type="button"
                  className="text-xs text-muted hover:text-ink flex items-center gap-1 cursor-pointer"
                  onClick={() => setShowAdvancedCapyKeyOptions(!showAdvancedCapyKeyOptions)}
                >
                  {showAdvancedCapyKeyOptions ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                  <span>{t('modal.capykey.advanced_toggle')}</span>
                </button>

                {showAdvancedCapyKeyOptions && (
                  <div className="flex flex-col gap-3 mt-2.5 p-3 bg-sunken rounded-sm border border-hairline">
                    <div className="ds-field">
                      <label className="ds-label">{t('modal.capykey.rpm_label')}</label>
                      <input
                        type="number"
                        min="0"
                        placeholder={t('modal.capykey.rpm_placeholder')}
                        value={newCapyKey.rate_limit_rpm || ''}
                        onChange={(e) => setNewCapyKey({ ...newCapyKey, rate_limit_rpm: Number(e.target.value) || 0 })}
                        className="ds-input text-xs"
                      />
                    </div>

                    <div className="ds-field">
                      <div className="flex justify-between items-center mb-1">
                        <label className="ds-label mb-0">{t('modal.capykey.enabled_models')}</label>
                        <button
                          type="button"
                          className="text-xs text-accent hover:underline cursor-pointer"
                          onClick={() => setSelectedModelPills(['*'])}
                        >
                          {t('modal.capykey.all_models_pill')}
                        </button>
                      </div>

                      {(() => {
                        if (!newCapyKey.pool_id) {
                          return (
                            <div className="p-2.5 bg-surface rounded-sm border border-hairline text-xs text-muted">
                              {t('modal.capykey.select_pool_first_hint')}
                            </div>
                          );
                        }

                        const poolModels = getModelsForPool(newCapyKey.pool_id);

                        return (
                          <div className="flex flex-col gap-2">
                            <div className="p-2 bg-surface rounded-sm border border-hairline flex flex-wrap gap-1 max-h-32 overflow-y-auto">
                              <button
                                type="button"
                                className={`px-2 py-0.5 text-xs rounded-sm border cursor-pointer ${
                                  selectedModelPills.includes('*') ? 'bg-ink text-canvas font-medium' : 'bg-surface text-muted'
                                }`}
                                onClick={() => toggleModelPill('*')}
                              >
                                {t('modal.capykey.all_models_pill')}
                              </button>
                              {poolModels.map((m) => {
                                const isSel = selectedModelPills.includes(m) && !selectedModelPills.includes('*');
                                return (
                                  <button
                                    key={m}
                                    type="button"
                                    className={`px-2 py-0.5 text-xs rounded-sm border cursor-pointer transition-colors ${
                                      isSel ? 'bg-accent text-white font-medium border-accent' : 'bg-surface text-ink hover:border-accent'
                                    }`}
                                    onClick={() => toggleModelPill(m)}
                                  >
                                    {m}
                                  </button>
                                );
                              })}
                              {/* Extra custom models entered */}
                              {selectedModelPills
                                .filter((p) => p !== '*' && !poolModels.includes(p))
                                .map((customM) => (
                                  <button
                                    key={customM}
                                    type="button"
                                    className="px-2 py-0.5 text-xs rounded-sm border bg-accent text-white font-medium cursor-pointer"
                                    onClick={() => toggleModelPill(customM)}
                                    title="Rimuovi modello personalizzato"
                                  >
                                    {customM} ✕
                                  </button>
                                ))}
                            </div>

                            {/* Option to type custom extra model */}
                            <div className="flex items-center gap-1.5">
                              <input
                                type="text"
                                placeholder={t('modal.capykey.custom_model_placeholder')}
                                value={customCapyKeyModelInput}
                                onChange={(e) => setCustomCapyKeyModelInput(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    if (customCapyKeyModelInput.trim()) {
                                      const val = customCapyKeyModelInput.trim();
                                      if (!selectedModelPills.includes(val)) {
                                        setSelectedModelPills([...selectedModelPills.filter((p) => p !== '*'), val]);
                                      }
                                      setCustomCapyKeyModelInput('');
                                    }
                                  }
                                }}
                                className="ds-input text-xs flex-1"
                              />
                              <button
                                type="button"
                                className="ds-btn ds-btn--secondary ds-btn--sm shrink-0"
                                onClick={() => {
                                  if (customCapyKeyModelInput.trim()) {
                                    const val = customCapyKeyModelInput.trim();
                                    if (!selectedModelPills.includes(val)) {
                                      setSelectedModelPills([...selectedModelPills.filter((p) => p !== '*'), val]);
                                    }
                                    setCustomCapyKeyModelInput('');
                                  }
                                }}
                              >
                                {t('modal.capykey.add_model_btn')}
                              </button>
                            </div>
                          </div>
                        );
                      })()}
                    </div>

                    <div className="ds-field">
                      <label className="ds-label">{t('modal.capykey.metadata_label')}</label>
                      <label className="flex items-center gap-2 cursor-pointer mt-1">
                        <input
                          type="checkbox"
                          checked={newCapyKey.include_metadata}
                          onChange={(e) => setNewCapyKey({ ...newCapyKey, include_metadata: e.target.checked })}
                          className="w-4 h-4 rounded border-hairline accent-accent cursor-pointer"
                        />
                        <span className="text-xs font-medium text-ink">
                          {t('modal.capykey.metadata_toggle')}
                        </span>
                      </label>
                      <p className="text-[11px] text-muted mt-1 leading-relaxed">
                        {t('modal.capykey.metadata_desc')}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 mt-2 pt-2 border-t border-hairline">
                <button
                  type="button"
                  className="ds-btn ds-btn--secondary"
                  onClick={() => setShowAddCapyKeyModal(false)}
                >
                  {t('modal.capykey.cancel')}
                </button>
                <button type="submit" className="ds-btn ds-btn--primary">
                  {editingCapyKeyId ? t('modal.capykey.submit_edit') : t('modal.capykey.submit')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Display Created Key Token (Shown ONLY ONCE) */}
      {createdCapyKeySecret && (
        <div className="fixed inset-0 bg-scrim flex items-center justify-center p-4 z-50 animate-in fade-in duration-150" onClick={(e) => { if (e.target === e.currentTarget) setCreatedCapyKeySecret(null); }}>
          <div className="ds-card shadow-float w-full max-w-lg flex flex-col gap-4 border border-hairline max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                <CapyLogo size={24} />
                <h3 className="text-base font-bold text-ok-text">{t('modal.capykey_created.title')}</h3>
              </div>
              <button type="button" onClick={() => setCreatedCapyKeySecret(null)} className="text-muted hover:text-ink cursor-pointer p-1 rounded-sm hover:bg-sunken"><X size={16} /></button>
            </div>

            <p className="text-xs text-muted leading-relaxed">
              {t('modal.capykey_created.warning')}
            </p>

            <div className="p-3 bg-sunken rounded-sm border border-hairline flex items-center justify-between gap-2 overflow-hidden">
              <code className="text-xs font-mono select-all break-all text-ink font-semibold">{createdCapyKeySecret}</code>
              <button
                type="button"
                className="ds-btn ds-btn--secondary ds-btn--sm whitespace-nowrap flex items-center gap-1"
                onClick={handleCopySecret}
              >
                {copiedSecret ? <Check size={13} className="text-ok-text" /> : <Copy size={13} />}
                <span>{copiedSecret ? t('modal.capykey_created.copied') : t('modal.capykey_created.copy_btn')}</span>
              </button>
            </div>

            <div className="p-3 bg-canvas rounded-sm border border-hairline text-xs font-mono text-body">
              curl http://localhost:3000/v1/chat/completions \<br />
              &nbsp;&nbsp;-H &quot;Authorization: Bearer {createdCapyKeySecret}&quot; \<br />
              &nbsp;&nbsp;-H &quot;Content-Type: application/json&quot; \<br />
              &nbsp;&nbsp;-d &apos;{JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'Ciao!' }] })}&apos;
            </div>

            <div className="flex justify-end mt-2">
              <button
                type="button"
                className="ds-btn ds-btn--primary ds-btn--sm"
                onClick={() => setCreatedCapyKeySecret(null)}
              >
                {t('modal.capykey_created.close')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Add Pool */}
      {showAddPoolModal && (
        <div className="fixed inset-0 bg-scrim flex items-center justify-center p-4 z-50 animate-in fade-in duration-150" onClick={(e) => { if (e.target === e.currentTarget) setShowAddPoolModal(false); }}>
          <div className="ds-card shadow-float w-full max-w-md flex flex-col gap-4 border border-hairline max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-base font-bold text-ink">{editingPoolId ? t('modal.pool.title_edit') : t('modal.pool.title')}</h3>
                <p className="text-xs text-muted">{t('modal.pool.subtitle')}</p>
              </div>
              <button type="button" onClick={() => setShowAddPoolModal(false)} className="text-muted hover:text-ink cursor-pointer p-1 rounded-sm hover:bg-sunken"><X size={16} /></button>
            </div>

            {poolModalError && (
              <div className="p-3 bg-err-wash text-err-text border border-err-line rounded-sm text-xs flex items-center gap-2">
                <AlertTriangle size={14} className="shrink-0" />
                <span>{poolModalError}</span>
              </div>
            )}

            <form onSubmit={handleCreatePool} className="flex flex-col gap-3.5">
              <div className="ds-field">
                <label className="ds-label">{t('modal.pool.id_label')}</label>
                <input
                  type="text"
                  required
                  disabled={!!editingPoolId}
                  placeholder={t('modal.pool.id_placeholder')}
                  value={newPool.id}
                  onChange={(e) => setNewPool({ ...newPool, id: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '-') })}
                  className={`ds-input text-xs font-mono ${editingPoolId ? 'opacity-60 cursor-not-allowed bg-sunken' : ''}`}
                />
              </div>

              <div className="ds-field">
                <label className="ds-label">{t('modal.pool.name_label')}</label>
                <input
                  type="text"
                  required
                  placeholder={t('modal.pool.name_placeholder')}
                  value={newPool.name}
                  onChange={(e) => setNewPool({ ...newPool, name: e.target.value })}
                  className="ds-input text-xs"
                />
              </div>

              <div className="ds-field">
                <label className="ds-label">{t('modal.pool.desc_label')}</label>
                <input
                  type="text"
                  placeholder={t('modal.pool.desc_placeholder')}
                  value={newPool.description}
                  onChange={(e) => setNewPool({ ...newPool, description: e.target.value })}
                  className="ds-input text-xs"
                />
              </div>

              <BudgetLimitControl
                idPrefix="modal-pool-budget"
                limit={newPool.budget_limit}
                type={newPool.budget_type}
                cadence={newPool.budget_cadence}
                onChange={({ limit, type, cadence }) =>
                  setNewPool({
                    ...newPool,
                    budget_limit: limit,
                    budget_type: type,
                    budget_cadence: cadence,
                  })
                }
              />

              <div className="ds-field">
                <div className="flex justify-between items-center">
                  <label className="ds-label">{t('modal.pool.reasoning_label')}</label>
                  <span className="text-[10px] text-muted">models.dev</span>
                </div>
                <select
                  value={newPool.reasoning_policy || 'inherit'}
                  onChange={(e) => setNewPool({ ...newPool, reasoning_policy: e.target.value })}
                  className="ds-input text-xs"
                >
                  <option value="inherit">{t('modal.pool.reasoning_inherit')}</option>
                  <option value="low">{t('modal.pool.reasoning_low')}</option>
                  <option value="medium">{t('modal.pool.reasoning_medium')}</option>
                  <option value="high">{t('modal.pool.reasoning_high')}</option>
                  <option value="none">{t('modal.pool.reasoning_none')}</option>
                </select>
                <span className="text-[11px] text-muted">{t('modal.pool.reasoning_hint')}</span>
              </div>

              <div className="p-3 bg-sunken border border-hairline rounded-sm flex items-start gap-2.5">
                <input
                  type="checkbox"
                  id="pool-resilience-checkbox"
                  checked={newPool.allow_cross_model_fallback === 1}
                  onChange={(e) => setNewPool({ ...newPool, allow_cross_model_fallback: e.target.checked ? 1 : 0 })}
                  className="mt-0.5 cursor-pointer"
                />
                <label htmlFor="pool-resilience-checkbox" className="text-xs text-ink cursor-pointer select-none">
                  <span className="font-semibold block">{t('modal.pool.resilience_label')}</span>
                  <span className="text-muted text-[11px] block mt-0.5">{t('modal.pool.resilience_desc')}</span>
                </label>
              </div>

              <div className="flex justify-end gap-2 mt-2 pt-2 border-t border-hairline">
                <button
                  type="button"
                  className="ds-btn ds-btn--secondary"
                  onClick={() => setShowAddPoolModal(false)}
                >
                  {t('modal.pool.cancel')}
                </button>
                <button type="submit" className="ds-btn ds-btn--primary">
                  {editingPoolId ? t('modal.pool.submit_edit') : t('modal.pool.submit')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Attach Key to Pool */}
      {targetPoolForRoute && (
        <div className="fixed inset-0 bg-scrim flex items-center justify-center p-4 z-50 animate-in fade-in duration-150" onClick={(e) => { if (e.target === e.currentTarget) setTargetPoolForRoute(null); }}>
          <div className="ds-card shadow-float w-full max-w-sm flex flex-col gap-4 border border-hairline max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-base font-bold text-ink">
                  {editingRouteIndex !== null ? t('modal.route.title_edit') : t('modal.route.title')}
                </h3>
                <p className="text-xs text-muted">{targetPoolForRoute.name} ({targetPoolForRoute.id})</p>
              </div>
              <button type="button" onClick={() => setTargetPoolForRoute(null)} className="text-muted hover:text-ink cursor-pointer p-1 rounded-sm hover:bg-sunken"><X size={16} /></button>
            </div>

            {routeModalError && (
              <div className="p-3 bg-err-wash text-err-text border border-err-line rounded-sm text-xs flex items-center gap-2">
                <AlertTriangle size={14} className="shrink-0" />
                <span>{routeModalError}</span>
              </div>
            )}

            <form onSubmit={handleSaveRoute} className="flex flex-col gap-3.5">
              <div className="ds-field">
                <label className="ds-label">{t('modal.route.key_label')}</label>
                <select
                  value={newRouteKeyId}
                  onChange={(e) => {
                    setNewRouteKeyId(e.target.value);
                    setNewRoutePattern('*');
                  }}
                  className="ds-input text-xs"
                  required
                >
                  {keys.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.name} ({k.provider}) {k.is_free_tier ? '• Free' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="ds-field">
                <label className="ds-label">{t('modal.route.model_label')}</label>
                <input
                  type="text"
                  required
                  placeholder={t('modal.route.model_placeholder')}
                  value={newRoutePattern}
                  onChange={(e) => setNewRoutePattern(e.target.value)}
                  className="ds-input text-xs font-mono"
                />

                {/* Validation Status Indicator */}
                {(() => {
                  const selectedKeyForRoute = keys.find((k) => k.id === newRouteKeyId);
                  const discovered: string[] = selectedKeyForRoute?.discovered_models && Array.isArray(selectedKeyForRoute.discovered_models)
                    ? selectedKeyForRoute.discovered_models
                    : [];
                  if (newRoutePattern.trim() === '*' || newRoutePattern.trim() === '') return null;
                  if (discovered.length === 0) return null;

                  const parts = newRoutePattern.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
                  const discoveredLower = discovered.map((m: string) => m.toLowerCase());
                  const unverified = parts.filter((p) => !discoveredLower.includes(p) && p !== '*');

                  if (unverified.length === 0 && parts.length > 0) {
                    return (
                      <div className="flex items-center gap-1.5 text-[11px] text-ok-text bg-ok-wash px-2 py-1 rounded-sm border border-ok-line mt-1">
                        <Check size={12} className="shrink-0" />
                        <span>{t('modal.route.validation_verified')}</span>
                      </div>
                    );
                  }
                  if (unverified.length > 0) {
                    return (
                      <div className="flex items-center gap-1.5 text-[11px] text-warn-text bg-warn-wash px-2 py-1 rounded-sm border border-warn-line mt-1">
                        <AlertTriangle size={12} className="shrink-0" />
                        <span>{t('modal.route.validation_warning')} ({unverified.join(', ')})</span>
                      </div>
                    );
                  }
                  return null;
                })()}

                {/* Autocomplete / Discovered Models Suggestion Pills */}
                {(() => {
                  const selectedKeyForRoute = keys.find((k) => k.id === newRouteKeyId);
                  const discovered: string[] = selectedKeyForRoute?.discovered_models && Array.isArray(selectedKeyForRoute.discovered_models)
                    ? selectedKeyForRoute.discovered_models
                    : [];
                  if (discovered.length === 0) return null;

                  return (
                    <div className="flex flex-col gap-1 mt-1.5">
                      <span className="text-[11px] text-muted font-medium">{t('modal.route.suggestions_label')}</span>
                      <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto p-1.5 bg-sunken rounded-sm border border-hairline">
                        <button
                          type="button"
                          onClick={() => setNewRoutePattern('*')}
                          className={`px-2 py-0.5 text-xs rounded-sm border cursor-pointer ${
                            newRoutePattern === '*' ? 'bg-ink text-canvas font-medium' : 'bg-surface text-muted hover:text-ink'
                          }`}
                        >
                          {t('modal.route.all_models_pill')}
                        </button>
                        {discovered.map((m: string) => {
                          const parts = newRoutePattern.split(',').map((s) => s.trim());
                          const isSel = parts.includes(m);
                          return (
                            <button
                              key={m}
                              type="button"
                              onClick={() => {
                                if (newRoutePattern === '*' || !newRoutePattern.trim()) {
                                  setNewRoutePattern(m);
                                } else {
                                  if (parts.includes(m)) {
                                    const filtered = parts.filter((p) => p !== m && p !== '');
                                    setNewRoutePattern(filtered.length > 0 ? filtered.join(', ') : '*');
                                  } else {
                                    setNewRoutePattern([...parts.filter((p) => p !== '*'), m].join(', '));
                                  }
                                }
                              }}
                              className={`px-2 py-0.5 text-xs rounded-sm border cursor-pointer transition-colors ${
                                isSel ? 'bg-accent text-white font-medium border-accent' : 'bg-surface text-ink hover:border-accent'
                              }`}
                            >
                              {m}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                <span className="text-[11px] text-muted">{t('modal.route.model_hint')}</span>
              </div>

              <div className="ds-field">
                <label className="ds-label">{t('modal.route.limit_label')}</label>
                <input
                  type="number"
                  min="0"
                  step="1000"
                  placeholder={t('modal.route.limit_placeholder')}
                  value={newRouteTokenLimit || ''}
                  onChange={(e) => setNewRouteTokenLimit(Number(e.target.value) || 0)}
                  className="ds-input text-xs"
                />
              </div>

              <div className="ds-field">
                <label className="ds-label">{t('modal.route.reasoning_label')}</label>
                <select
                  value={newRouteReasoningEffort}
                  onChange={(e) => setNewRouteReasoningEffort(e.target.value)}
                  className="ds-input text-xs"
                >
                  <option value="inherit">
                    {t('modal.route.reasoning_inherit')} ({targetPoolForRoute?.reasoning_policy || 'inherit'})
                  </option>
                  <option value="low">low (~2K tokens / light)</option>
                  <option value="medium">medium (~8K tokens / balanced)</option>
                  <option value="high">high / max (~32K tokens / deep)</option>
                  <option value="none">none / fast (0 tokens / disabled)</option>
                </select>
                <span className="text-[11px] text-muted">{t('modal.route.reasoning_hint')}</span>
              </div>

              <div className="flex justify-end gap-2 mt-2 pt-2 border-t border-hairline">
                <button
                  type="button"
                  className="ds-btn ds-btn--secondary"
                  onClick={() => setTargetPoolForRoute(null)}
                >
                  {t('modal.route.cancel')}
                </button>
                <button type="submit" className="ds-btn ds-btn--primary">
                  {editingRouteIndex !== null ? t('modal.route.submit_edit') : t('modal.route.submit')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Add/Edit Pricing Rule */}
      {showAddPricingModal && (
        <div className="fixed inset-0 bg-scrim flex items-center justify-center p-4 z-50 animate-in fade-in duration-150" onClick={(e) => { if (e.target === e.currentTarget) setShowAddPricingModal(false); }}>
          <div className="ds-card shadow-float w-full max-w-md flex flex-col gap-4 border border-hairline max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center">
              <h3 className="text-base font-bold text-ink">
                {editingPricingId ? t('modal.pricing.title_edit') : t('modal.pricing.title_new')}
              </h3>
              <button type="button" onClick={() => setShowAddPricingModal(false)} className="text-muted hover:text-ink cursor-pointer p-1 rounded-sm hover:bg-sunken"><X size={16} /></button>
            </div>

            {pricingModalError && (
              <div className="p-3 bg-err-wash text-err-text border border-err-line rounded-sm text-xs flex items-center gap-2">
                <AlertTriangle size={14} className="shrink-0" />
                <span>{pricingModalError}</span>
              </div>
            )}

            <form onSubmit={handleSavePricingRule} className="flex flex-col gap-3">
              <div className="ds-field">
                <label className="ds-label">{t('modal.pricing.model_label')}</label>
                <input
                  type="text"
                  required
                  placeholder={t('modal.pricing.model_placeholder')}
                  value={newPricingRule.model}
                  onChange={(e) => setNewPricingRule({ ...newPricingRule, model: e.target.value })}
                  className="ds-input text-xs"
                />
              </div>

              <div className="ds-field">
                <label className="ds-label">{t('modal.pricing.provider_label')}</label>
                <select
                  value={newPricingRule.provider}
                  onChange={(e) => setNewPricingRule({ ...newPricingRule, provider: e.target.value })}
                  className="ds-input text-xs"
                >
                  <option value="">{t('modal.pricing.all_providers')}</option>
                  <option value="openai">OpenAI</option>
                  <option value="gemini">Google Gemini</option>
                  <option value="groq">Groq</option>
                  <option value="mistral">Mistral AI</option>
                  <option value="deepseek">DeepSeek</option>
                  <option value="openrouter">OpenRouter</option>
                  <option value="together">Together AI</option>
                  <option value="ollama">Ollama</option>
                  <option value="jev">Jev</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="ds-field">
                  <label className="ds-label">{t('modal.pricing.prompt_label')}</label>
                  <input
                    type="number"
                    step="0.001"
                    min="0"
                    required
                    placeholder="es. 2.50"
                    value={newPricingRule.prompt_price_per_1m || ''}
                    onChange={(e) => setNewPricingRule({ ...newPricingRule, prompt_price_per_1m: Number(e.target.value) || 0 })}
                    className="ds-input text-xs"
                  />
                </div>

                <div className="ds-field">
                  <label className="ds-label">{t('modal.pricing.completion_label')}</label>
                  <input
                    type="number"
                    step="0.001"
                    min="0"
                    required
                    placeholder="es. 10.00"
                    value={newPricingRule.completion_price_per_1m || ''}
                    onChange={(e) => setNewPricingRule({ ...newPricingRule, completion_price_per_1m: Number(e.target.value) || 0 })}
                    className="ds-input text-xs"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 mt-2 pt-2 border-t border-hairline">
                <button
                  type="button"
                  className="ds-btn ds-btn--secondary"
                  onClick={() => setShowAddPricingModal(false)}
                >
                  {t('modal.pricing.cancel')}
                </button>
                <button type="submit" className="ds-btn ds-btn--primary">
                  {editingPricingId ? t('modal.pricing.submit_edit') : t('modal.pricing.submit_new')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Model Technical Specification & Metadata Sheet */}
      {selectedModelForDetails && (
        <div
          className="fixed inset-0 bg-scrim flex items-center justify-center p-4 z-50 animate-in fade-in duration-150"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedModelForDetails(null);
          }}
        >
          <div className="ds-card shadow-float w-full max-w-3xl flex flex-col gap-5 border border-hairline max-h-[92vh] overflow-y-auto">
            {/* Header */}
            <div className="flex justify-between items-start border-b border-hairline pb-4">
              <div>
                <div className="flex items-center gap-2.5 flex-wrap">
                  <h3 className="text-xl font-bold text-ink">
                    {selectedModelForDetails.metadata?.name || selectedModelForDetails.model}
                  </h3>
                  {selectedModelForDetails.metadata?.reasoning ? (
                    <span className="ds-badge ds-badge--accent text-xs font-semibold px-2 py-0.5">Reasoning Model</span>
                  ) : (
                    <span className="ds-badge ds-badge--neutral text-xs px-2 py-0.5">Standard Chat</span>
                  )}
                  <span className="ds-badge bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-xs px-2 py-0.5 flex items-center gap-1 font-medium">
                    <Sparkles size={11} />
                    <span>{t('pricing.sheet_badge_live')}</span>
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                  <code className="text-xs font-mono text-muted bg-sunken px-2 py-0.5 rounded-xs border border-hairline">
                    {selectedModelForDetails.model}
                  </code>
                  {selectedModelForDetails.metadata?.family && (
                    <span className="text-xs text-muted">
                      {t('pricing.sheet_family')}: <strong className="text-ink font-semibold uppercase">{selectedModelForDetails.metadata.family}</strong>
                    </span>
                  )}
                  {selectedModelForDetails.metadata?.canonicalModelId && selectedModelForDetails.metadata.canonicalModelId !== selectedModelForDetails.model && (
                    <span className="text-xs text-muted font-mono">
                      {t('pricing.sheet_canonical_id')}: {selectedModelForDetails.metadata.canonicalModelId}
                    </span>
                  )}
                </div>
                {selectedModelForDetails.metadata?.description && (
                  <p className="text-xs text-muted mt-2 max-w-2xl leading-relaxed">
                    {selectedModelForDetails.metadata.description}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setSelectedModelForDetails(null)}
                className="text-muted hover:text-ink cursor-pointer p-1.5 rounded-sm hover:bg-sunken shrink-0"
              >
                <X size={18} />
              </button>
            </div>

            {/* Section 1: Reasoning & Dialetti */}
            <div className="p-4 bg-surface rounded-sm border border-hairline flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-ink uppercase tracking-wider flex items-center gap-1.5">
                  <Zap size={14} className="text-accent" />
                  <span>{t('pricing.sheet_sec_capabilities')}</span>
                </h4>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-1">
                {/* Reasoning Effort options */}
                <div className="p-3 bg-sunken rounded-sm border border-hairline flex flex-col gap-1.5">
                  <span className="text-[11px] font-semibold text-ink">{t('pricing.sheet_reasoning_effort_values')}</span>
                  {selectedModelForDetails.metadata?.reasoning_options && selectedModelForDetails.metadata.reasoning_options.length > 0 ? (
                    <div className="flex flex-col gap-2">
                      {selectedModelForDetails.metadata.reasoning_options.map((opt: any, idx: number) => (
                        <div key={idx} className="flex flex-col gap-1">
                          <span className="text-[10px] text-muted font-mono uppercase">Tipo: {opt.type}</span>
                          {opt.values && Array.isArray(opt.values) && (
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {opt.values.map((v: string) => (
                                <span key={v} className="ds-badge ds-badge--accent text-xs font-mono font-semibold px-2 py-0.5">
                                  {v}
                                </span>
                              ))}
                            </div>
                          )}
                          {opt.type === 'budget_tokens' && (
                            <span className="text-xs text-ink font-mono">
                              Min: {opt.min || 1024} tokens · Max: {opt.max || 64000} tokens
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : selectedModelForDetails.metadata?.reasoning ? (
                    <span className="text-xs text-ink font-medium">Reasoning attivo (Opzioni standard)</span>
                  ) : (
                    <span className="text-xs text-muted italic">{t('pricing.sheet_no_reasoning')}</span>
                  )}
                </div>

                {/* Temperature & Sampling Behavior */}
                <div className="p-3 bg-sunken rounded-sm border border-hairline flex flex-col gap-1.5">
                  <span className="text-[11px] font-semibold text-ink">{t('pricing.sheet_sampling_support')}</span>
                  {selectedModelForDetails.metadata?.temperature === false ? (
                    <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-500/10 p-2.5 rounded-xs border border-amber-500/20">
                      <Shield size={15} className="shrink-0 mt-0.5 text-amber-600" />
                      <span className="leading-snug">{t('pricing.sheet_sampling_rejected')}</span>
                    </div>
                  ) : (
                    <div className="flex items-start gap-2 text-xs text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 p-2.5 rounded-xs border border-emerald-500/20">
                      <Check size={15} className="shrink-0 mt-0.5 text-emerald-600" />
                      <span className="leading-snug">{t('pricing.sheet_sampling_allowed')}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Feature Badges: Tool Calling, Structured Output, Open Weights */}
              <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-hairline">
                <span className={`ds-badge text-xs px-2 py-0.5 ${selectedModelForDetails.metadata?.toolCall ? 'ds-badge--accent' : 'ds-badge--neutral text-muted'}`}>
                  Tool Calling: {selectedModelForDetails.metadata?.toolCall ? 'Supportato' : 'No'}
                </span>
                <span className={`ds-badge text-xs px-2 py-0.5 ${selectedModelForDetails.metadata?.structuredOutput !== false ? 'ds-badge--accent' : 'ds-badge--neutral text-muted'}`}>
                  Structured Output (JSON): {selectedModelForDetails.metadata?.structuredOutput !== false ? 'Supportato' : 'No'}
                </span>
                {selectedModelForDetails.metadata?.openWeights !== undefined && (
                  <span className="ds-badge ds-badge--neutral text-xs px-2 py-0.5">
                    {selectedModelForDetails.metadata.openWeights ? t('pricing.sheet_open_weights_yes') : t('pricing.sheet_open_weights_no')}
                  </span>
                )}
              </div>
            </div>

            {/* Section 2: Specifiche e Contesto */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 bg-sunken rounded-sm border border-hairline flex flex-col gap-1">
                <span className="text-[11px] font-medium text-muted">{t('pricing.context_window')}</span>
                <span className="text-lg font-bold text-ink">
                  {selectedModelForDetails.metadata?.limit?.context
                    ? selectedModelForDetails.metadata.limit.context >= 1_000_000
                      ? `${(selectedModelForDetails.metadata.limit.context / 1_000_000).toFixed(1).replace('.0', '')}M token`
                      : `${(selectedModelForDetails.metadata.limit.context / 1000).toFixed(0)}k token`
                    : 'N/A'}
                </span>
              </div>

              <div className="p-3 bg-sunken rounded-sm border border-hairline flex flex-col gap-1">
                <span className="text-[11px] font-medium text-muted">{t('pricing.max_output')}</span>
                <span className="text-lg font-bold text-ink">
                  {selectedModelForDetails.metadata?.limit?.output
                    ? `${(selectedModelForDetails.metadata.limit.output / 1000).toFixed(0)}k token`
                    : 'N/A'}
                </span>
              </div>

              <div className="p-3 bg-sunken rounded-sm border border-hairline flex flex-col gap-1">
                <span className="text-[11px] font-medium text-muted">{t('pricing.sheet_release_date')}</span>
                <span className="text-sm font-bold text-ink">
                  {selectedModelForDetails.metadata?.releaseDate || selectedModelForDetails.metadata?.lastUpdated || 'N/A'}
                </span>
              </div>

              <div className="p-3 bg-sunken rounded-sm border border-hairline flex flex-col gap-1">
                <span className="text-[11px] font-medium text-muted">{t('pricing.sheet_knowledge')}</span>
                <span className="text-sm font-bold text-ink">
                  {selectedModelForDetails.metadata?.knowledge || 'N/A'}
                </span>
              </div>
            </div>

            {/* Section 3: Fornitori e Prezzi Disponibili */}
            <div className="flex flex-col gap-2">
              <h4 className="text-xs font-bold text-ink uppercase tracking-wider flex items-center gap-1.5">
                <Database size={14} className="text-accent" />
                <span>{t('pricing.sheet_sec_providers')}</span>
              </h4>
              <div className="ds-table-wrap border border-hairline rounded-sm">
                <table className="ds-table">
                  <thead>
                    <tr>
                      <th>{t('pricing.col_provider')}</th>
                      <th className="ds-table__num">{t('pricing.col_input')}</th>
                      <th className="ds-table__num">{t('pricing.col_output')}</th>
                      <th className="ds-table__num">{t('pricing.col_actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedModelForDetails.providers.map((prov: any) => {
                      const testState = catalogTestingState[prov.key_id];
                      return (
                        <tr key={prov.key_id}>
                          <td>
                            <div className="flex items-center gap-2">
                              {prov.provider_logo_url && (
                                <img src={prov.provider_logo_url} alt={prov.provider} className="w-4 h-4 object-contain" />
                              )}
                              <span className="font-semibold text-xs text-ink">{prov.key_name}</span>
                              <span className="text-[11px] font-mono text-muted uppercase">({prov.provider})</span>
                              {prov.is_free_tier && (
                                <span className="ds-badge ds-badge--accent text-[10px]">Free Tier</span>
                              )}
                            </div>
                          </td>
                          <td className="ds-table__num font-mono text-xs">
                            ${prov.prompt_price_per_1m.toFixed(2)}
                          </td>
                          <td className="ds-table__num font-mono text-xs">
                            ${prov.completion_price_per_1m.toFixed(2)}
                          </td>
                          <td className="ds-table__num">
                            <button
                              type="button"
                              className="ds-btn ds-btn--secondary ds-btn--sm text-xs py-1 px-2.5"
                              onClick={() => handleTestCatalogProvider(prov.key_id)}
                              disabled={testState?.loading}
                            >
                              <Zap size={11} className={testState?.loading ? 'animate-spin text-accent' : ''} />
                              <span>{testState?.loading ? '...' : t('pricing.btn_test')}</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Section 4: JSON Raw Inspection (Provenance) */}
            <div className="p-3 bg-sunken rounded-sm border border-hairline flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-ink flex items-center gap-1.5">
                  <Info size={13} className="text-accent" />
                  <span>{t('pricing.sheet_sec_raw')}</span>
                </span>
                <button
                  type="button"
                  onClick={() => setShowRawJson(!showRawJson)}
                  className="text-xs text-accent hover:underline cursor-pointer font-medium flex items-center gap-1"
                >
                  {showRawJson ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  <span>{showRawJson ? 'Nascondi JSON' : 'Espandi JSON grezzo'}</span>
                </button>
              </div>

              {showRawJson && (
                <div className="relative mt-2">
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(
                        JSON.stringify(selectedModelForDetails.metadata?.rawMetadata || selectedModelForDetails.metadata, null, 2)
                      );
                      setCopiedRawJson(true);
                      setTimeout(() => setCopiedRawJson(false), 2000);
                    }}
                    className="absolute right-2 top-2 ds-btn ds-btn--secondary ds-btn--sm text-[10px] py-0.5 px-2 flex items-center gap-1 bg-surface z-10"
                  >
                    {copiedRawJson ? <Check size={11} className="text-emerald-500" /> : <Copy size={11} />}
                    <span>{copiedRawJson ? 'Copiato' : 'Copia'}</span>
                  </button>
                  <pre className="p-3 bg-canvas text-ink text-[11px] font-mono rounded-xs border border-hairline max-h-60 overflow-y-auto leading-relaxed">
                    {JSON.stringify(selectedModelForDetails.metadata?.rawMetadata || selectedModelForDetails.metadata, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal: Model Statistics Deep Dive */}
      {selectedModelForStats && (
        <div className="fixed inset-0 bg-scrim flex items-center justify-center p-4 z-50 animate-in fade-in duration-150" onClick={(e) => { if (e.target === e.currentTarget) setSelectedModelForStats(null); }}>
          <div className="ds-card shadow-float w-full max-w-2xl flex flex-col gap-5 border border-hairline max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-start border-b border-hairline pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-bold text-ink">
                    {selectedModelForStats}
                  </h3>
                  <span className="ds-badge ds-badge--accent text-xs">{t('analytics.model_badge')}</span>
                </div>
                <p className="text-xs text-muted mt-0.5">
                  {t('analytics.model_subtitle')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedModelForStats(null);
                  setModelDetailStats(null);
                }}
                className="text-muted hover:text-ink cursor-pointer p-1 rounded-sm hover:bg-sunken"
              >
                <X size={16} />
              </button>
            </div>

            {loadingModelStats ? (
              <div className="py-16 text-center text-xs text-muted flex flex-col items-center gap-2">
                <RefreshCw size={18} className="animate-spin text-accent" />
                <span>{t('analytics.model_loading', { model: selectedModelForStats || '' })}</span>
              </div>
            ) : !modelDetailStats || modelDetailStats.total_requests === 0 ? (
              <div className="py-12 text-center text-xs text-muted">
                {t('analytics.model_no_traffic')}
              </div>
            ) : (
              <div className="flex flex-col gap-5">
                {/* 4 Airy KPI Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="p-3 bg-sunken rounded-sm border border-hairline flex flex-col gap-1">
                    <span className="text-[11px] font-medium text-muted">{t('analytics.model_kpi_requests')}</span>
                    <span className="text-xl font-bold text-ink">{modelDetailStats.total_requests}</span>
                    <span className="text-[10px] text-muted">
                      {t('analytics.model_kpi_success_rate', { rate: modelDetailStats.success_rate_pct })}
                    </span>
                  </div>

                  <div className="p-3 bg-sunken rounded-sm border border-hairline flex flex-col gap-1">
                    <span className="text-[11px] font-medium text-muted">{t('analytics.model_kpi_tokens')}</span>
                    <span className="text-xl font-bold text-ink">{modelDetailStats.total_tokens.toLocaleString()}</span>
                    <span className="text-[10px] text-muted">
                      {modelDetailStats.total_prompt_tokens.toLocaleString()} in · {modelDetailStats.total_completion_tokens.toLocaleString()} out
                    </span>
                  </div>

                  <div className="p-3 bg-sunken rounded-sm border border-hairline flex flex-col gap-1">
                    <span className="text-[11px] font-medium text-muted">{t('analytics.model_kpi_latency')}</span>
                    <span className="text-xl font-bold text-ink">{modelDetailStats.avg_latency_ms} ms</span>
                    <span className="text-[10px] text-muted">
                      {modelDetailStats.avg_ttft_ms > 0 ? `TTFT ${modelDetailStats.avg_ttft_ms} ms` : t('analytics.model_kpi_not_measured')}
                    </span>
                  </div>

                  <div className="p-3 bg-sunken rounded-sm border border-hairline flex flex-col gap-1">
                    <span className="text-[11px] font-medium text-muted">{t('analytics.model_kpi_spend')}</span>
                    <span className="text-xl font-bold text-ink">${modelDetailStats.total_spend_usd.toFixed(4)}</span>
                    <span className="text-[10px] text-muted">USD</span>
                  </div>
                </div>

                {/* Token Ratio Bar (Prompt vs Completion) */}
                <div className="p-4 bg-surface rounded-sm border border-hairline flex flex-col gap-2">
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-semibold text-ink">
                      {t('analytics.model_tokens_breakdown')}
                    </span>
                    <span className="text-muted text-[11px]">
                      Prompt: {Math.round((modelDetailStats.total_prompt_tokens / Math.max(modelDetailStats.total_tokens, 1)) * 100)}% · Completion: {Math.round((modelDetailStats.total_completion_tokens / Math.max(modelDetailStats.total_tokens, 1)) * 100)}%
                    </span>
                  </div>
                  <div className="w-full bg-sunken h-2.5 rounded-sm overflow-hidden flex">
                    <div
                      className="bg-accent h-full transition-all duration-300"
                      style={{ width: `${Math.round((modelDetailStats.total_prompt_tokens / Math.max(modelDetailStats.total_tokens, 1)) * 100)}%` }}
                      title={`Prompt: ${modelDetailStats.total_prompt_tokens.toLocaleString()} token`}
                    />
                    <div
                      className="bg-ink h-full transition-all duration-300"
                      style={{ width: `${Math.round((modelDetailStats.total_completion_tokens / Math.max(modelDetailStats.total_tokens, 1)) * 100)}%` }}
                      title={`Completion: ${modelDetailStats.total_completion_tokens.toLocaleString()} token`}
                    />
                  </div>
                  <div className="flex items-center gap-4 text-[11px] text-muted mt-0.5">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-accent inline-block" />
                      <span>Prompt (input): {modelDetailStats.total_prompt_tokens.toLocaleString()}</span>
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-ink inline-block" />
                      <span>Completion (output): {modelDetailStats.total_completion_tokens.toLocaleString()}</span>
                    </span>
                  </div>
                </div>

                {/* Table 1: Breakdown by Provider */}
                <div className="flex flex-col gap-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-muted">
                    {t('analytics.model_providers_title')}
                  </h4>
                  <div className="bg-surface border border-hairline rounded-sm overflow-hidden text-xs">
                    <table className="ds-table">
                      <thead>
                        <tr>
                          <th>{t('analytics.model_col_provider')}</th>
                          <th>{t('analytics.model_col_requests')}</th>
                          <th>{t('analytics.model_col_latency')}</th>
                          <th>{t('analytics.model_col_tokens')}</th>
                          <th>{t('analytics.model_col_errors')}</th>
                          <th className="ds-table__num">{t('analytics.model_col_cost')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {modelDetailStats.by_provider.map((prov) => (
                          <tr key={prov.provider}>
                            <td className="font-semibold text-ink">
                              <span className="ds-badge text-[10px]">{prov.provider}</span>
                            </td>
                            <td>
                              <div className="flex items-center gap-2">
                                <span>{prov.requests}</span>
                                <span className="ds-badge text-[10px]">{prov.share_pct}%</span>
                              </div>
                            </td>
                            <td className="text-muted font-mono text-[11px]">
                              {prov.avg_latency_ms} ms {prov.avg_ttft_ms > 0 ? `· TTFT ${prov.avg_ttft_ms} ms` : ''} {prov.tokens_per_sec ? `· ${prov.tokens_per_sec} tok/s` : ''}
                            </td>
                            <td>{prov.total_tokens.toLocaleString()}</td>
                            <td>
                              {prov.error_count > 0 ? (
                                <span className="ds-badge ds-badge--err text-[10px]">{prov.error_count}</span>
                              ) : (
                                <span className="text-muted text-[11px]">0</span>
                              )}
                            </td>
                            <td className="ds-table__num font-semibold text-ink">${prov.cost_usd.toFixed(4)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Table 2: Breakdown by Application */}
                {modelDetailStats.by_app.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-muted">
                      {t('analytics.model_apps_title')}
                    </h4>
                    <div className="bg-surface border border-hairline rounded-sm overflow-hidden text-xs">
                      <table className="ds-table">
                        <thead>
                          <tr>
                            <th>{t('analytics.model_col_app')}</th>
                            <th>{t('analytics.model_col_app_requests')}</th>
                            <th>{t('analytics.model_col_app_share')}</th>
                            <th>{t('analytics.model_col_app_tokens')}</th>
                            <th className="ds-table__num">{t('analytics.model_col_cost')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {modelDetailStats.by_app.map((app) => (
                            <tr key={app.app_id}>
                              <td className="font-semibold text-ink flex items-center gap-1.5">
                                <Key size={12} className="text-accent" />
                                <span>{app.app_name}</span>
                              </td>
                              <td>{app.requests}</td>
                              <td>
                                <span className="ds-badge text-[10px]">{app.share_pct}%</span>
                              </td>
                              <td>{app.total_tokens.toLocaleString()}</td>
                              <td className="ds-table__num font-semibold text-ink">${app.cost_usd.toFixed(4)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end pt-2 border-t border-hairline">
              <button
                type="button"
                className="ds-btn ds-btn--secondary ds-btn--sm"
                onClick={() => {
                  setSelectedModelForStats(null);
                  setModelDetailStats(null);
                }}
              >
                {t('common.close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
