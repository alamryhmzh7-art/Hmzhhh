import React, { useState } from 'react';
import { useI18n } from '../i18n/I18nContext';
import { ANDROID_PROJECT_FILES, AndroidCodeFile } from '../android/androidCodeManifest';
import { 
  Code, 
  Copy, 
  Check, 
  Download, 
  FileCode, 
  Terminal, 
  Cpu, 
  CheckCircle2, 
  Layers,
  FileText,
  Smartphone
} from 'lucide-react';

export const AndroidProjectView: React.FC = () => {
  const { t, isRtl } = useI18n();
  const [selectedFile, setSelectedFile] = useState<AndroidCodeFile>(ANDROID_PROJECT_FILES[2]); // Default to TcpClient.kt
  const [copied, setCopied] = useState<boolean>(false);

  const handleCopyCode = () => {
    navigator.clipboard.writeText(selectedFile.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleDownloadFile = () => {
    const fileName = selectedFile.path.split('/').pop() || 'file.kt';
    const blob = new Blob([selectedFile.code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Smartphone className="h-5 w-5 text-emerald-400" />
            <h2 className="text-lg font-bold text-white">
              {t('androidCodeTitle')}
            </h2>
            <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800 font-mono font-bold">
              Kotlin 2.0 / Jetpack Compose / SDK 34
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Production-Grade Android Architecture (MVVM + Clean Architecture + Coroutines + Material 3)
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleCopyCode}
            className="px-4 py-2 rounded-lg text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center gap-1.5 transition-colors"
          >
            {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
            <span>{copied ? 'Copied' : 'Copy File'}</span>
          </button>

          <button
            onClick={handleDownloadFile}
            className="px-4 py-2 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-2 transition-all shadow-md shadow-emerald-950/50"
          >
            <Download className="h-4 w-4" />
            <span>Download Source</span>
          </button>
        </div>
      </div>

      {/* APK Compilation Instructions Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-3">
        <h3 className="text-xs font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-2">
          <Terminal className="h-4 w-4" />
          <span>How to Compile and Build the Android APK</span>
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-slate-300">
          <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 space-y-1">
            <span className="font-bold text-emerald-400 block">1. Open in Android Studio</span>
            <p className="text-[11px] text-slate-400">Clone/copy the manifest files into Android Studio Hedgehog / Iguana / Jellyfish with JDK 17.</p>
          </div>
          <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 space-y-1">
            <span className="font-bold text-cyan-400 block">2. Sync Gradle Dependencies</span>
            <p className="text-[11px] text-slate-400">Run <code className="text-white font-mono">./gradlew build</code> to download Kotlin Compose BOM and Coroutines.</p>
          </div>
          <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 space-y-1">
            <span className="font-bold text-purple-400 block">3. Generate Signed APK</span>
            <p className="text-[11px] text-slate-400">Run <code className="text-white font-mono">./gradlew assembleRelease</code> to output <code className="text-white font-mono">app-release.apk</code>.</p>
          </div>
        </div>
      </div>

      {/* File Explorer & Code Viewer */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left Column: File Tree */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-2">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-3">
            Native Android Source Tree
          </span>
          <div className="space-y-1.5">
            {ANDROID_PROJECT_FILES.map((file) => {
              const isSelected = selectedFile.path === file.path;
              return (
                <button
                  key={file.path}
                  onClick={() => setSelectedFile(file)}
                  className={`w-full text-left p-2.5 rounded-lg border transition-all text-xs font-mono flex items-center gap-2 ${
                    isSelected
                      ? 'bg-emerald-950/40 border-emerald-500 text-white shadow-md font-bold'
                      : 'bg-slate-800/40 border-slate-700/60 text-slate-400 hover:text-slate-200 hover:border-slate-600'
                  }`}
                >
                  <FileCode className="h-4 w-4 shrink-0 text-emerald-400" />
                  <span className="truncate">{file.path.split('/').pop()}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right Column: Code Window */}
        <div className="lg:col-span-3 bg-slate-950 border border-slate-800 rounded-xl overflow-hidden shadow-2xl font-mono text-xs">
          {/* File Header */}
          <div className="bg-slate-900 px-4 py-2.5 flex items-center justify-between border-b border-slate-800">
            <span className="text-emerald-400 font-bold">{selectedFile.path}</span>
            <span className="text-[11px] text-slate-400">{isRtl ? selectedFile.descriptionAr : selectedFile.descriptionEn}</span>
          </div>

          {/* Code Viewer Body */}
          <pre className="p-4 max-h-[520px] overflow-y-auto overflow-x-auto text-slate-200 text-xs leading-relaxed">
            <code>{selectedFile.code}</code>
          </pre>
        </div>
      </div>
    </div>
  );
};
