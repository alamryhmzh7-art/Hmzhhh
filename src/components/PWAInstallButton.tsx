import React, { useState } from 'react';
import { Download, Smartphone, X, CheckCircle2 } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { useI18n } from '../i18n/I18nContext';
import logoImg from '../assets/images/hamza_obd_logo_1789331768510.jpg';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const { isRtl } = useI18n();
  const [showGuide, setShowGuide] = useState(false);

  // If already running as an installed standalone app
  if (isInstalled) {
    return (
      <div className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-semibold">
        <CheckCircle2 className="w-3.5 h-3.5" />
        <span>{isRtl ? 'التطبيق مثبت' : 'App Installed'}</span>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={async () => {
          if (isInstallable) {
            await install();
          } else {
            setShowGuide(true);
          }
        }}
        className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-bold text-xs transition-all shadow-md shadow-cyan-500/20 active:scale-95 border border-cyan-300/30"
        title={isRtl ? 'تثبيت التطبيق على هاتف المحمول بالشعار الجديد' : 'Install app on phone with logo'}
      >
        <Download className="w-4 h-4 animate-bounce" />
        <span>{isRtl ? 'تثبيت التطبيق على الهاتف' : 'Install App'}</span>
      </button>

      {showGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-700/60 p-6 shadow-2xl relative text-slate-100">
            <button
              onClick={() => setShowGuide(false)}
              className="absolute top-4 left-4 text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="h-12 w-12 rounded-2xl overflow-hidden border border-cyan-400/40 shadow-lg shadow-cyan-500/20 shrink-0">
                <img src={logoImg} alt="HAMZA OBD PRO Logo" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">
                  {isRtl ? 'تثبيت HAMZA OBD PRO على الهاتف' : 'Install HAMZA OBD PRO'}
                </h3>
                <p className="text-xs text-cyan-400 font-mono">PWA Mobile App</p>
              </div>
            </div>

            <div className="space-y-3 text-xs leading-relaxed text-slate-300 bg-slate-950/60 rounded-xl p-4 border border-slate-800">
              {isIOS ? (
                <>
                  <p className="font-bold text-cyan-300">📱 خطوات التثبيت على آيفون / آيباد (iOS):</p>
                  <ol className="list-decimal list-inside space-y-1.5 pr-2">
                    <li>اضغط على زر <strong>المشاركة (Share)</strong> في أسفل متصفح Safari.</li>
                    <li>اختر <strong>"إضافة إلى الشاشة الرئيسية" (Add to Home Screen)</strong>.</li>
                    <li>سيظهر الشعار الجديد للتطبيق مباشرة على شاشة هاتفك.</li>
                  </ol>
                </>
              ) : (
                <>
                  <p className="font-bold text-cyan-300">📱 خطوات التثبيت على أندرويد / الكمبيوتر:</p>
                  <ol className="list-decimal list-inside space-y-1.5 pr-2">
                    <li>اضغط على قائمة المتصفح (⋮ الأيقونة أعلى اليمين/اليسار).</li>
                    <li>اختر <strong>"تثبيت التطبيق" (Install app)</strong> أو <strong>"إضافة للشاشة الرئيسية"</strong>.</li>
                    <li>سيظهر تطبيق <strong>HAMZA OBD PRO</strong> بشعاره الفاخر مباشرة بين تطبيقات هاتفك!</li>
                  </ol>
                </>
              )}
            </div>

            <button
              onClick={() => setShowGuide(false)}
              className="mt-5 w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs border border-slate-600 transition"
            >
              {isRtl ? 'حسناً، فهمت' : 'Got it'}
            </button>
          </div>
        </div>
      )}
    </>
  );
};
