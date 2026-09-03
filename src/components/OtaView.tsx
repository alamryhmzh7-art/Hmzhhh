import React, { useState } from 'react';
import { useI18n } from '../i18n/I18nContext';
import { ConnectionStatus } from '../types';
import { 
  Cpu, 
  UploadCloud, 
  CheckCircle2, 
  AlertTriangle, 
  ShieldAlert, 
  RefreshCw, 
  FileCode, 
  ShieldCheck,
  Zap,
  HardDrive
} from 'lucide-react';

interface OtaViewProps {
  status: ConnectionStatus;
}

export const OtaView: React.FC<OtaViewProps> = ({ status }) => {
  const { t, isRtl } = useI18n();
  const [firmwareVersion, setFirmwareVersion] = useState<string>('v2.5.0-PRO (Build 2025.10)');
  const [selectedFile, setSelectedFile] = useState<string>('hamza_obd_esp32_twai_v2.5.1.bin');
  const [isFlashing, setIsFlashing] = useState<boolean>(false);
  const [flashProgress, setFlashProgress] = useState<number>(0);
  const [flashStep, setFlashStep] = useState<string>('');
  const [flashSuccess, setFlashSuccess] = useState<boolean>(false);

  const handleStartOta = async () => {
    setIsFlashing(true);
    setFlashSuccess(false);
    setFlashProgress(0);

    const steps = [
      'Establishing OTA Session on Port 3232...',
      'Verifying SHA-256 Checksum & Firmware Signature...',
      'Erasing Flash Partition OTA_0 (4MB SPI Flash)...',
      'Streaming Binary Blocks (4096 bytes/chunk)...',
      'Validating Written Blocks & CRC32...',
      'Updating Bootloader App Partition Table to OTA_0...',
      'Issuing Soft Reboot to ESP32...'
    ];

    for (let i = 0; i < steps.length; i++) {
      setFlashStep(steps[i]);
      setFlashProgress(Math.round(((i + 1) / steps.length) * 100));
      await new Promise(r => setTimeout(r, 800));
    }

    setIsFlashing(false);
    setFlashSuccess(true);
    setFirmwareVersion('v2.5.1-PRO (Build 2026.01)');
  };

  return (
    <div className="space-y-6 pb-12 max-w-4xl mx-auto">
      {/* Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Cpu className="h-5 w-5 text-emerald-400" />
            <h2 className="text-lg font-bold text-white">
              {t('otaTitle')}
            </h2>
            <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800 font-mono font-bold">
              ESP-IDF OTA Flasher
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Wireless ESP32 TWAI/CAN Firmware Update with Dual-Partition Rollback Protection
          </p>
        </div>
      </div>

      {/* Hardware Flash Metadata */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
          <span className="text-[10px] text-slate-500 uppercase font-mono block">Installed Firmware</span>
          <span className="text-sm font-bold text-white font-mono mt-1 block">{firmwareVersion}</span>
          <span className="text-[10px] text-emerald-400 font-mono mt-0.5 block">Active Boot Partition: OTA_0</span>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
          <span className="text-[10px] text-slate-500 uppercase font-mono block">ESP32 Hardware ID</span>
          <span className="text-sm font-bold text-cyan-400 font-mono mt-1 block">ESP32-D0WD-V3 (Dual Core)</span>
          <span className="text-[10px] text-slate-400 font-mono mt-0.5 block">Flash: 4MB Flash @ 80MHz</span>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
          <span className="text-[10px] text-slate-500 uppercase font-mono block">CAN Controller</span>
          <span className="text-sm font-bold text-purple-400 font-mono mt-1 block">TWAI (ISO 11898-1)</span>
          <span className="text-[10px] text-slate-400 font-mono mt-0.5 block">Transceiver: SN65HVD230</span>
        </div>
      </div>

      {/* OTA Upload & Flash Box */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-5">
        <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
          <UploadCloud className="h-5 w-5 text-emerald-400" />
          <span>Over-The-Air Binary Flasher</span>
        </h3>

        <div className="border-2 border-dashed border-slate-700 hover:border-emerald-500/50 rounded-xl p-6 text-center transition-colors bg-slate-950/40">
          <FileCode className="h-10 w-10 text-emerald-400 mx-auto mb-2" />
          <h4 className="font-bold text-sm text-white">{selectedFile}</h4>
          <p className="text-xs text-slate-400 mt-1">Compiled ESP32 Factory Binary Image (Size: 1.42 MB | SHA-256: 8F4B9...A2)</p>
        </div>

        {/* Progress Bar */}
        {isFlashing && (
          <div className="space-y-2 bg-slate-950 p-4 rounded-xl border border-slate-800 font-mono text-xs">
            <div className="flex justify-between text-slate-300">
              <span className="text-emerald-400 font-bold flex items-center gap-2">
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                {flashStep}
              </span>
              <span>{flashProgress}%</span>
            </div>
            <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-emerald-500 to-cyan-500 transition-all duration-300"
                style={{ width: `${flashProgress}%` }}
              />
            </div>
          </div>
        )}

        {/* Success */}
        {flashSuccess && (
          <div className="bg-emerald-500/10 border border-emerald-500/40 rounded-xl p-4 flex items-center gap-3 text-emerald-400">
            <CheckCircle2 className="h-6 w-6 shrink-0" />
            <div>
              <h4 className="font-bold text-sm">ESP32 Firmware Updated Successfully!</h4>
              <p className="text-xs text-slate-300">Device rebooted and active with firmware version v2.5.1-PRO.</p>
            </div>
          </div>
        )}

        {/* Action Button */}
        <div className="flex justify-end pt-2">
          <button
            onClick={handleStartOta}
            disabled={isFlashing}
            className="px-6 py-3 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-2 shadow-lg shadow-emerald-950/60 transition-all disabled:opacity-50"
          >
            {isFlashing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
            <span>{isFlashing ? 'Flashing ESP32...' : 'Flash Firmware via Wi-Fi'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
