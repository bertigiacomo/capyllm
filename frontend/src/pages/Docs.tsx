import React, { useState, useEffect } from 'react';
import {
  ArrowLeft,
  BookOpen,
  Check,
  Copy,
  Code2,
  Terminal,
  Cpu,
  Layers,
  Key,
  ShieldCheck,
  Sparkles,
  Laptop,
  Sun,
  Moon,
  Info,
} from 'lucide-react';
import { CapyLogo } from '../components/CapyLogo';
import { useI18n } from '../i18n';
import { toggleDarkMode, isDarkMode } from '../theme';

export interface CapyKeyItem {
  id: string;
  name: string;
  key_prefix: string;
  [key: string]: any;
}

interface DocsProps {
  onBack: () => void;
  capyKeys: CapyKeyItem[];
}

export const Docs: React.FC<DocsProps> = ({ onBack, capyKeys }) => {
  const { t, lang, setLang } = useI18n();
  const [dark, setDark] = useState(isDarkMode());
  const [selectedKeyId, setSelectedKeyId] = useState<string>(capyKeys[0]?.id || 'demo');
  const [activeSnippetTab, setActiveSnippetTab] = useState<'python' | 'node' | 'curl' | 'apps'>('python');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    if ((!selectedKeyId || selectedKeyId === 'demo') && capyKeys.length > 0) {
      setSelectedKeyId(capyKeys[0].id);
    }
  }, [capyKeys]);

  const handleToggleTheme = () => {
    const isNowDark = toggleDarkMode();
    setDark(isNowDark);
  };

  const handleCopy = (code: string, id: string) => {
    navigator.clipboard.writeText(code);
    setCopiedKey(id);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  const selectedKeyObj = capyKeys.find((k) => k.id === selectedKeyId) || capyKeys[0];
  const activeKeyPlaceholder = selectedKeyObj
    ? `${selectedKeyObj.key_prefix}_••••••••••••••••••••••••`
    : 'capy_live_xxxxxx_your_secret_key_here';

  // Code snippets (bilingual)
  const isIt = lang === 'it';
  const pythonSnippet = isIt
    ? `# 1. Installa la libreria ufficiale: pip install openai
from openai import OpenAI

# 2. Invece delle credenziali OpenAI dirette, punta a CapyLLM:
client = OpenAI(
    base_url="${currentOrigin}/v1",
    api_key="${activeKeyPlaceholder}"
)

# 3. Chiama qualsiasi modello come hai sempre fatto (inclusi streaming, json mode e function calling):
response = client.chat.completions.create(
    model="gpt-4o",
    messages=[
        {"role": "system", "content": "Sei un assistente intelligente gestito da CapyLLM."},
        {"role": "user", "content": "Spiegami il principio di funzionamento dei pool in poche righe."}
    ],
    temperature=0.7
)

print(response.choices[0].message.content)

# CapyLLM inietta automaticamente metadati trasparenti di latenza e costo:
meta = getattr(response, 'capy_meta', None)
if meta:
    print(f"Eseguito su: {meta.get('provider')} | Latenza: {meta.get('latency_ms')}ms")`
    : `# 1. Install the official library: pip install openai
from openai import OpenAI

# 2. Point to CapyLLM instead of raw upstream credentials:
client = OpenAI(
    base_url="${currentOrigin}/v1",
    api_key="${activeKeyPlaceholder}"
)

# 3. Call any model just like vanilla OpenAI (including streaming, json mode, tools):
response = client.chat.completions.create(
    model="gpt-4o",
    messages=[
        {"role": "system", "content": "You are a helpful assistant managed through CapyLLM."},
        {"role": "user", "content": "Explain how inference pools work in two sentences."}
    ],
    temperature=0.7
)

print(response.choices[0].message.content)

# CapyLLM automatically attaches latency, model resolution and cost telemetry:
meta = getattr(response, 'capy_meta', None)
if meta:
    print(f"Served by: {meta.get('provider')} | Resolved: {meta.get('resolved_model')} | Latency: {meta.get('latency_ms')}ms")`;

  const nodeSnippet = isIt
    ? `// 1. Installa l'SDK ufficiale: npm install openai
import OpenAI from 'openai';

// 2. Inizializza il client verso l'endpoint locale di CapyLLM:
const openai = new OpenAI({
  baseURL: '${currentOrigin}/v1',
  apiKey: '${activeKeyPlaceholder}',
});

async function main() {
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'user', content: 'Come posso instradare il traffico con CapyLLM?' }
    ],
    stream: true, // Streaming SSE supportato nativamente a zero latenza
  });

  for await (const chunk of completion) {
    process.stdout.write(chunk.choices[0]?.delta?.content || '');
  }
  process.stdout.write('\\n');
}

main().catch(console.error);`
    : `// 1. Install official SDK: npm install openai
import OpenAI from 'openai';

// 2. Initialize client pointing to your CapyLLM gateway:
const openai = new OpenAI({
  baseURL: '${currentOrigin}/v1',
  apiKey: '${activeKeyPlaceholder}',
});

async function main() {
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'user', content: 'How does CapyLLM route inference requests?' }
    ],
    stream: true, // Native zero-overhead SSE streaming
  });

  for await (const chunk of completion) {
    process.stdout.write(chunk.choices[0]?.delta?.content || '');
  }
  process.stdout.write('\\n');
}

main().catch(console.error);`;

  const curlSnippet = isIt
    ? `# Chiamata standard OpenAI-compatible tramite cURL
curl ${currentOrigin}/v1/chat/completions \\
  -H "Authorization: Bearer ${activeKeyPlaceholder}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-4o",
    "messages": [
      { "role": "user", "content": "Ciao CapyLLM! Rispondimi in una frase." }
    ],
    "temperature": 0.5
  }'`
    : `# Standard OpenAI-compatible call via cURL
curl ${currentOrigin}/v1/chat/completions \\
  -H "Authorization: Bearer ${activeKeyPlaceholder}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-4o",
    "messages": [
      { "role": "user", "content": "Hello CapyLLM! Reply in one short sentence." }
    ],
    "temperature": 0.5
  }'`;

  return (
    <div className="min-h-screen bg-canvas text-ink flex flex-col font-sans">
      {/* Top Header */}
      <header className="border-b border-hairline bg-surface sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onBack}
              className="ds-btn ds-btn--secondary ds-btn--sm flex items-center gap-1.5 cursor-pointer"
              title={t('docs.back_to_dashboard')}
            >
              <ArrowLeft size={14} />
              <span>{t('docs.back_to_dashboard')}</span>
            </button>
            <div className="h-4 w-[1px] bg-hairline hidden sm:block" />
            <div className="flex items-center gap-2">
              <CapyLogo size={24} />
              <span className="font-bold text-sm tracking-tight hidden sm:inline">CapyLLM Docs</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Language Switch */}
            <button
              type="button"
              className="ds-btn ds-btn--ghost ds-btn--sm px-2 text-xs font-semibold cursor-pointer"
              onClick={() => setLang(lang === 'it' ? 'en' : 'it')}
              title={t('header.lang_toggle')}
            >
              {lang === 'it' ? 'EN' : 'IT'}
            </button>

            {/* Dark Mode Switch */}
            <button
              type="button"
              className="ds-btn ds-btn--ghost ds-btn--icon cursor-pointer"
              onClick={handleToggleTheme}
              title={t('header.theme_toggle')}
            >
              {dark ? <Sun size={15} /> : <Moon size={15} />}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-8 sm:py-12 flex flex-col gap-10">
        {/* Hero Section */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="ds-badge ds-badge--accent text-xs flex items-center gap-1">
              <BookOpen size={12} />
              <span>{t('docs.badge')}</span>
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-ink">
            {t('docs.hero_title')}
          </h1>
          <p className="text-sm sm:text-base text-muted leading-relaxed max-w-3xl">
            {t('docs.hero_desc')}
          </p>
        </div>

        {/* ========================================================================= */}
        {/* PARTE 1: COS'È CAPYLLM E IL PROBLEMA REALE CHE RISOLVE */}
        {/* ========================================================================= */}
        <section className="ds-card p-6 sm:p-8 flex flex-col gap-6 border border-hairline">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-sm bg-accent-wash text-accent flex items-center justify-center font-bold text-sm">
              1
            </div>
            <div>
              <h2 className="text-lg font-bold text-ink">{t('docs.section1_title')}</h2>
              <p className="text-xs text-muted">{t('docs.section1_subtitle')}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs sm:text-sm text-body leading-relaxed">
            <div className="p-4 bg-sunken rounded-sm border border-hairline flex flex-col gap-2">
              <span className="font-bold text-err-text flex items-center gap-1.5 text-xs uppercase tracking-wider">
                ✕ {t('docs.problem_title')}
              </span>
              <p className="text-muted">
                {t('docs.problem_desc')}
              </p>
            </div>

            <div className="p-4 bg-sunken rounded-sm border border-hairline flex flex-col gap-2">
              <span className="font-bold text-ok-text flex items-center gap-1.5 text-xs uppercase tracking-wider">
                ✓ {t('docs.solution_title')}
              </span>
              <p className="text-muted">
                {t('docs.solution_desc')}
              </p>
            </div>
          </div>

          {/* Triade Schema Visivo */}
          <div className="mt-2 flex flex-col gap-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted">
              {t('docs.triad_title')}
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
              {/* Box 1: Fornitori Upstream */}
              <div className="p-4 bg-canvas rounded-sm border border-hairline flex flex-col gap-2">
                <div className="flex items-center gap-2 text-accent">
                  <Cpu size={16} />
                  <span className="font-bold text-xs uppercase tracking-wider text-ink">{t('docs.triad_provider_title')}</span>
                </div>
                <p className="text-xs text-muted leading-relaxed">
                  {t('docs.triad_provider_desc')}
                </p>
              </div>

              {/* Box 2: Pool di Inferenza */}
              <div className="p-4 bg-canvas rounded-sm border border-hairline flex flex-col gap-2">
                <div className="flex items-center gap-2 text-accent">
                  <Layers size={16} />
                  <span className="font-bold text-xs uppercase tracking-wider text-ink">{t('docs.triad_pool_title')}</span>
                </div>
                <p className="text-xs text-muted leading-relaxed">
                  {t('docs.triad_pool_desc')}
                </p>
              </div>

              {/* Box 3: CapyKey */}
              <div className="p-4 bg-canvas rounded-sm border border-hairline flex flex-col gap-2">
                <div className="flex items-center gap-2 text-accent">
                  <Key size={16} />
                  <span className="font-bold text-xs uppercase tracking-wider text-ink">{t('docs.triad_capykey_title')}</span>
                </div>
                <p className="text-xs text-muted leading-relaxed">
                  {t('docs.triad_capykey_desc')}
                </p>
              </div>
            </div>

            <div className="p-3 bg-accent-wash text-accent-on rounded-sm text-xs leading-relaxed flex items-center gap-2.5">
              <Sparkles size={16} className="shrink-0 text-accent" />
              <span className="text-body font-medium">
                <strong>{t('docs.rule_golden_title')}:</strong> {t('docs.rule_golden_desc')}
              </span>
            </div>
          </div>
        </section>

        {/* ========================================================================= */}
        {/* PARTE 2: MIGRAZIONE DA OPENAI IN 30 SECONDI */}
        {/* ========================================================================= */}
        <section className="ds-card p-6 sm:p-8 flex flex-col gap-6 border border-hairline">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-sm bg-accent-wash text-accent flex items-center justify-center font-bold text-sm">
              2
            </div>
            <div>
              <h2 className="text-lg font-bold text-ink">{t('docs.section2_title')}</h2>
              <p className="text-xs text-muted">{t('docs.section2_subtitle')}</p>
            </div>
          </div>

          <p className="text-xs sm:text-sm text-body leading-relaxed">
            {t('docs.section2_text')}
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono">
            <div className="p-4 bg-sunken rounded-sm border border-err-line flex flex-col gap-2">
              <span className="font-sans font-bold text-err-text text-xs">{t('docs.before_label')} (OpenAI standard)</span>
              <pre className="text-muted text-[11px] overflow-x-auto select-all">
{`# Connessione diretta
client = OpenAI(
  api_key="sk-proj-xxxxxx"
)`}
              </pre>
            </div>

            <div className="p-4 bg-sunken rounded-sm border border-ok-line flex flex-col gap-2">
              <span className="font-sans font-bold text-ok-text text-xs">{t('docs.after_label')} {t('docs.after_with_capy')}</span>
              <pre className="text-ink text-[11px] overflow-x-auto select-all">
{`# Connessione protetta via CapyLLM
client = OpenAI(
  base_url="${currentOrigin}/v1",
  api_key="capy_live_..."
)`}
              </pre>
            </div>
          </div>
        </section>

        {/* ========================================================================= */}
        {/* PARTE 3: SNIPPET INTERATTIVI CON SELETTORE CAPYKEY */}
        {/* ========================================================================= */}
        <section className="ds-card p-6 sm:p-8 flex flex-col gap-6 border border-hairline">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-sm bg-accent-wash text-accent flex items-center justify-center font-bold text-sm">
                3
              </div>
              <div>
                <h2 className="text-lg font-bold text-ink">{t('docs.section3_title')}</h2>
                <p className="text-xs text-muted">{t('docs.section3_subtitle')}</p>
              </div>
            </div>

            {/* Interactive Key Selector */}
            {capyKeys.length > 0 && (
              <div className="flex items-center gap-2 bg-sunken p-1.5 px-3 rounded-sm border border-hairline">
                <Key size={13} className="text-muted" />
                <span className="text-xs text-muted font-medium whitespace-nowrap">{t('docs.select_key_label')}:</span>
                <select
                  value={selectedKeyId}
                  onChange={(e) => setSelectedKeyId(e.target.value)}
                  className="ds-input text-xs py-1 px-2 border-0 bg-transparent font-medium"
                >
                  {capyKeys.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.name} ({k.key_prefix}...)
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Snippet Tabs */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-1.5 border-b border-hairline pb-2 overflow-x-auto">
              <button
                type="button"
                onClick={() => setActiveSnippetTab('python')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-sm transition-all flex items-center gap-1.5 cursor-pointer ${
                  activeSnippetTab === 'python' ? 'bg-accent text-white' : 'bg-surface text-muted hover:text-ink'
                }`}
              >
                <Code2 size={13} />
                <span>Python SDK</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveSnippetTab('node')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-sm transition-all flex items-center gap-1.5 cursor-pointer ${
                  activeSnippetTab === 'node' ? 'bg-accent text-white' : 'bg-surface text-muted hover:text-ink'
                }`}
              >
                <Code2 size={13} />
                <span>Node.js / TypeScript</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveSnippetTab('curl')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-sm transition-all flex items-center gap-1.5 cursor-pointer ${
                  activeSnippetTab === 'curl' ? 'bg-accent text-white' : 'bg-surface text-muted hover:text-ink'
                }`}
              >
                <Terminal size={13} />
                <span>cURL / HTTP</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveSnippetTab('apps')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-sm transition-all flex items-center gap-1.5 cursor-pointer ${
                  activeSnippetTab === 'apps' ? 'bg-accent text-white' : 'bg-surface text-muted hover:text-ink'
                }`}
              >
                <Laptop size={13} />
                <span>{t('docs.tab_apps')}</span>
              </button>
            </div>

            {/* Tab: Python */}
            {activeSnippetTab === 'python' && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => handleCopy(pythonSnippet, 'py')}
                  className="absolute right-3 top-3 ds-btn ds-btn--secondary ds-btn--sm flex items-center gap-1 z-10"
                >
                  {copiedKey === 'py' ? <Check size={12} className="text-ok-text" /> : <Copy size={12} />}
                  <span>{copiedKey === 'py' ? t('docs.copied') : t('docs.copy_btn')}</span>
                </button>
                <pre className="p-4 bg-sunken rounded-sm border border-hairline font-mono text-xs overflow-x-auto text-ink leading-relaxed">
                  {pythonSnippet}
                </pre>
              </div>
            )}

            {/* Tab: Node */}
            {activeSnippetTab === 'node' && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => handleCopy(nodeSnippet, 'node')}
                  className="absolute right-3 top-3 ds-btn ds-btn--secondary ds-btn--sm flex items-center gap-1 z-10"
                >
                  {copiedKey === 'node' ? <Check size={12} className="text-ok-text" /> : <Copy size={12} />}
                  <span>{copiedKey === 'node' ? t('docs.copied') : t('docs.copy_btn')}</span>
                </button>
                <pre className="p-4 bg-sunken rounded-sm border border-hairline font-mono text-xs overflow-x-auto text-ink leading-relaxed">
                  {nodeSnippet}
                </pre>
              </div>
            )}

            {/* Tab: cURL */}
            {activeSnippetTab === 'curl' && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => handleCopy(curlSnippet, 'curl')}
                  className="absolute right-3 top-3 ds-btn ds-btn--secondary ds-btn--sm flex items-center gap-1 z-10"
                >
                  {copiedKey === 'curl' ? <Check size={12} className="text-ok-text" /> : <Copy size={12} />}
                  <span>{copiedKey === 'curl' ? t('docs.copied') : t('docs.copy_btn')}</span>
                </button>
                <pre className="p-4 bg-sunken rounded-sm border border-hairline font-mono text-xs overflow-x-auto text-ink leading-relaxed">
                  {curlSnippet}
                </pre>
              </div>
            )}

            {/* Tab: Apps & Agents */}
            {activeSnippetTab === 'apps' && (
              <div className="p-5 bg-sunken rounded-sm border border-hairline flex flex-col gap-4 text-xs leading-relaxed">
                <div>
                  <h4 className="font-bold text-ink text-sm mb-1">Cursor IDE & Continue.dev</h4>
                  <p className="text-muted">
                    {t('docs.apps_cursor_desc')}
                  </p>
                  <div className="mt-2 p-2.5 bg-canvas rounded-sm border border-hairline font-mono text-[11px] select-all">
                    Base URL: <span className="text-accent">{currentOrigin}/v1</span><br />
                    API Key: <span className="text-accent">{activeKeyPlaceholder}</span>
                  </div>
                </div>

                <div className="border-t border-hairline pt-3">
                  <h4 className="font-bold text-ink text-sm mb-1">Open WebUI / LibreChat / Chatbox</h4>
                  <p className="text-muted">
                    {t('docs.apps_chat_desc')}
                  </p>
                  <div className="mt-2 p-2.5 bg-canvas rounded-sm border border-hairline font-mono text-[11px] select-all">
                    OpenAI API Base: <span className="text-accent">{currentOrigin}/v1</span><br />
                    OpenAI API Key: <span className="text-accent">{activeKeyPlaceholder}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ========================================================================= */}
        {/* PARTE 4: HEADERS TRASPARENTI & OSSERVABILITÀ */}
        {/* ========================================================================= */}
        <section className="ds-card p-6 sm:p-8 flex flex-col gap-5 border border-hairline">
          <div className="flex items-center gap-2.5">
            <ShieldCheck size={18} className="text-accent" />
            <h3 className="text-base font-bold text-ink">{t('docs.section4_title')}</h3>
          </div>

          <p className="text-xs sm:text-sm text-muted leading-relaxed">
            {t('docs.section4_desc')}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="p-3 bg-sunken rounded-sm border border-hairline">
              <span className="font-mono font-bold text-accent">x-capyllm-upstream-provider</span>
              <p className="text-muted mt-1">{t('docs.header_provider_desc')}</p>
            </div>
            <div className="p-3 bg-sunken rounded-sm border border-hairline">
              <span className="font-mono font-bold text-accent">x-capyllm-latency-ms</span>
              <p className="text-muted mt-1">{t('docs.header_latency_desc')}</p>
            </div>
            <div className="p-3 bg-sunken rounded-sm border border-hairline">
              <span className="font-mono font-bold text-accent">x-capyllm-pool</span>
              <p className="text-muted mt-1">{t('docs.header_pool_desc')}</p>
            </div>
            <div className="p-3 bg-sunken rounded-sm border border-hairline">
              <span className="font-mono font-bold text-accent">Retry-After</span>
              <p className="text-muted mt-1">{t('docs.header_retry_desc')}</p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
};
