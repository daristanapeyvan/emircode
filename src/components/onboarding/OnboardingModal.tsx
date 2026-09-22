import React, { useState, useEffect } from 'react';
import { AppLogo } from '../common/AppLogo';
import { useSettingsStore } from '@/stores/settingsStore';
import { getTranslations } from '@/lib/localization/i18n';
import {
  ShieldCheck,
  Shield,
  Sliders,
  Sparkles,
  ArrowRight,
  ArrowLeft,
  CheckCircle,
  X,
} from 'lucide-react';

const ONBOARDING_KEY = 'emir_code_onboarding_completed';

export const OnboardingModal: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [currentSlide, setCurrentSlide] = useState(0);

  const { settings } = useSettingsStore();
  const t = getTranslations(settings.language);
  const isTr = settings.language === 'tr' || (settings.language === 'system' && navigator.language.startsWith('tr'));

  useEffect(() => {
    const seen = localStorage.getItem(ONBOARDING_KEY);
    if (!seen) {
      setIsOpen(true);
    }
  }, []);

  const handleClose = () => {
    localStorage.setItem(ONBOARDING_KEY, 'true');
    setIsOpen(false);
  };

  if (!isOpen) return null;

  const slides = isTr
    ? [
        {
          icon: <ShieldCheck size={32} className="text-emerald-400" />,
          title: "Emir Code'a Hoş Geldiniz",
          subtitle: 'Tamamen Yerel ve Özel Yapay Zekâ Kodlama Ajanı',
          description:
            'Tüm modeller ve kod analizleri bilgisayarınızdaki yerel Ollama üzerinde çalışır. Sıfır telemetri, sıfır bulut bağımlılığı ve %100 yerel gizlilik garantisi.',
          badge: 'Yerel Gizlilik',
        },
        {
          icon: <Shield size={32} className="text-cyan-400" />,
          title: 'Realpath Jail & Kriptografik Sandbox',
          subtitle: 'Sıfır Doğrudan Yazma İzni ve Atomik Mutasyonlar',
          description:
            'Ajan doğrudan dosyalara yazamaz veya silemez. Her işlem için tek kullanımlık 256-bit token üretilir, hash kontrolleri yapılır ve diske yalnızca onaylanan güvenli diff uygulanır.',
          badge: 'Güvenlik Mimarisi',
        },
        {
          icon: <Sliders size={32} className="text-purple-400" />,
          title: 'Yapılandırılabilir Güvenlik Profilleri',
          subtitle: 'Kontrol ve Otomasyon Arasındaki Dengeli Seçim',
          description:
            'Sıkı (her adımda onay sorar), Dengeli (güvenli dosya düzenlemelerini otomatik onaylar) ve Otonom (test komutlarını da koşturur) profilleriyle çalışma hızınızı kendiniz belirleyin.',
          badge: 'Esnek Profiller',
        },
        {
          icon: <Sparkles size={32} className="text-amber-400" />,
          title: 'Canlı Muhakeme & Doğal Akış',
          subtitle: 'Düşünce Sürecini İnceleyin, Akışta Yanıtlayın',
          description:
            'Ajanın muhakeme zincirini ve sistem dökümünü dilediğiniz an canlı takip edin. Ajan bir karar için size danıştığında pop-up çıkmaz; doğrudan doğal zaman çizelgesinde cevaplayabilirsiniz.',
          badge: 'Şeffaf Ajan Deneyimi',
        },
      ]
    : [
        {
          icon: <ShieldCheck size={32} className="text-emerald-400" />,
          title: 'Welcome to Emir Code',
          subtitle: 'Completely Local & Private AI Coding Agent',
          description:
            'All models and code reasoning execute strictly on your local machine via Ollama. Zero telemetry, zero cloud tracking, and 100% offline privacy.',
          badge: 'Local Privacy',
        },
        {
          icon: <Shield size={32} className="text-cyan-400" />,
          title: 'Realpath Jail & Cryptographic Sandbox',
          subtitle: 'Zero Direct Write Authority & Atomic Mutations',
          description:
            'The agent cannot write or delete files directly. Single-use 256-bit mutation tokens and SHA-256 base hashes ensure that only verified diffs touch your disk.',
          badge: 'Security Architecture',
        },
        {
          icon: <Sliders size={32} className="text-purple-400" />,
          title: 'Configurable Security Profiles',
          subtitle: 'Balance Safety and Productivity',
          description:
            'Choose between Strict (approves everything manually), Balanced (auto-applies safe non-conflicting edits), and Autonomous (executes test commands automatically).',
          badge: 'Flexible Profiles',
        },
        {
          icon: <Sparkles size={32} className="text-amber-400" />,
          title: 'Live Reasoning & Inline Stream',
          subtitle: 'Inspect Chain of Thought in Real-Time',
          description:
            'Optionally follow the live agent reasoning and execution dump. When the agent requests guidance, answers appear inline directly in the timeline without disruptive pop-ups.',
          badge: 'Transparent Experience',
        },
      ];

  const current = slides[currentSlide];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="bg-zinc-900 border border-zinc-700/80 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col relative">
        {/* Close Button */}
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors cursor-pointer z-10"
        >
          <X size={16} />
        </button>

        {/* Slide Visual Area */}
        <div className="p-8 pb-6 bg-gradient-to-b from-zinc-800/40 to-transparent flex flex-col items-center text-center">
          <div className="mb-4 relative">
            <div className="w-16 h-16 rounded-2xl bg-zinc-950 border border-zinc-750 flex items-center justify-center shadow-lg shadow-black/40">
              {current.icon}
            </div>
            <span className="absolute -bottom-2 -right-2 px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide uppercase bg-cyan-950/80 border border-cyan-700 text-cyan-300">
              {currentSlide + 1} / {slides.length}
            </span>
          </div>

          <span className="text-[11px] font-semibold text-zinc-400 tracking-wider uppercase mb-1.5">
            {current.badge}
          </span>
          <h2 className="text-lg font-bold text-zinc-100 mb-1 tracking-tight">
            {current.title}
          </h2>
          <p className="text-xs text-cyan-400 font-medium mb-3">
            {current.subtitle}
          </p>
          <p className="text-xs text-zinc-300 leading-relaxed max-w-sm">
            {current.description}
          </p>
        </div>

        {/* Carousel Indicators */}
        <div className="flex items-center justify-center gap-2 py-2">
          {slides.map((_, idx) => (
            <button
              key={idx}
              onClick={() => setCurrentSlide(idx)}
              className={`h-2 rounded-full transition-all cursor-pointer ${
                idx === currentSlide
                  ? 'w-6 bg-cyan-500'
                  : 'w-2 bg-zinc-700 hover:bg-zinc-600'
              }`}
            />
          ))}
        </div>

        {/* Footer Actions */}
        <div className="p-5 border-t border-zinc-800 bg-zinc-950/60 flex items-center justify-between">
          <button
            onClick={() => setCurrentSlide(Math.max(0, currentSlide - 1))}
            disabled={currentSlide === 0}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            <ArrowLeft size={13} />
            <span>{isTr ? 'Geri' : 'Back'}</span>
          </button>

          {currentSlide < slides.length - 1 ? (
            <button
              onClick={() => setCurrentSlide(currentSlide + 1)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold shadow-md shadow-cyan-950/40 transition-colors cursor-pointer"
            >
              <span>{isTr ? 'İleri' : 'Next'}</span>
              <ArrowRight size={13} />
            </button>
          ) : (
            <button
              onClick={handleClose}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-md shadow-emerald-950/40 transition-colors cursor-pointer"
            >
              <CheckCircle size={14} />
              <span>{isTr ? "Emir Code'a Başlayın" : 'Get Started with Emir Code'}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
