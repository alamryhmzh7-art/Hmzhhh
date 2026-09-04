import React, { useState } from 'react';
import { useI18n } from '../i18n/I18nContext';
import { VinInfo, ConnectionStatus } from '../types';
import { VinDecoder } from '../obd/vinDecoder';
import { transportManager } from '../network/TransportManager';
import { 
  Car, 
  Search, 
  CheckCircle2, 
  Globe, 
  Calendar, 
  MapPin, 
  Cpu, 
  FileText, 
  ShieldCheck,
  RefreshCw,
  Hash
} from 'lucide-react';

interface VinViewProps {
  status: ConnectionStatus;
  vinInfo: VinInfo;
  setVinInfo: (info: VinInfo) => void;
  isMockMode?: boolean;
}

export const VinView: React.FC<VinViewProps> = ({ status, vinInfo, setVinInfo, isMockMode = false }) => {
  const { t, isRtl } = useI18n();
  const [manualVin, setManualVin] = useState<string>(vinInfo.rawVin || '4T1BF1FK5NU123456');
  const [isReading, setIsReading] = useState<boolean>(false);

  const handleReadVinFromEcu = async () => {
    setIsReading(true);
    try {
      // Send Mode 09 PID 02 (VIN request) via transportManager
      const resp = await transportManager.sendRequest([0x09, 0x02], '0x7E0');
      let vinToDecode = manualVin;
      if (isMockMode) {
         vinToDecode = '4T1BF1FK5NU123456';
      } else if (resp.status === 'SUCCESS' && resp.decodedData) {
         vinToDecode = resp.decodedData; // In a real app, this should be the decoded ASCII from the response payload
      }
      const decoded = VinDecoder.decode(vinToDecode);
      setVinInfo(decoded);
      setManualVin(decoded.rawVin);
    } catch {
      //
    } finally {
      setIsReading(false);
    }
  };

  const handleDecodeManual = () => {
    const clean = manualVin.trim().toUpperCase();
    const decoded = VinDecoder.decode(clean);
    setVinInfo(decoded);
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Car className="h-5 w-5 text-cyan-400" />
            <h2 className="text-lg font-bold text-white">
              {t('vinTitle')}
            </h2>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            ISO 3779 VIN Decoder & Mode 09 PID 02 / UDS DID 0xF190
          </p>
        </div>

        <button
          onClick={handleReadVinFromEcu}
          disabled={isReading}
          className="px-4 py-2 rounded-lg text-xs font-bold bg-cyan-600 hover:bg-cyan-500 text-white flex items-center gap-2 transition-all shadow-md shadow-cyan-950/50"
        >
          <RefreshCw className={`h-4 w-4 ${isReading ? 'animate-spin' : ''}`} />
          <span>{isReading ? t('connecting') : t('btnReadVin')}</span>
        </button>
      </div>

      {/* Search / Manual Input Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[260px] relative">
          <input
            type="text"
            maxLength={17}
            value={manualVin}
            onChange={(e) => setManualVin(e.target.value.toUpperCase())}
            placeholder={t('vinPlaceholder')}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-sm font-mono tracking-widest text-white uppercase focus:outline-none focus:border-cyan-500"
          />
        </div>
        <button
          onClick={handleDecodeManual}
          className="px-5 py-2.5 rounded-lg text-xs font-bold bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 transition-colors flex items-center gap-2"
        >
          <Search className="h-4 w-4" />
          <span>{t('btnDecodeVin')}</span>
        </button>
      </div>

      {/* Decoded VIN Breakdown Display */}
      {vinInfo.isValid ? (
        <div className="space-y-6">
          {/* Large VIN Visualizer Card */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                17-Character ISO 3779 Standard Vehicle Identification Number
              </span>
              <span className="text-xs px-2.5 py-1 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 font-bold flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Valid ISO 3779 Checksum
              </span>
            </div>

            <div className="flex flex-wrap gap-1.5 font-mono text-center justify-center sm:justify-start">
              {vinInfo.rawVin.split('').map((char, idx) => {
                let badgeColor = 'bg-slate-800 text-slate-300';
                let label = '';

                if (idx < 3) {
                  badgeColor = 'bg-cyan-500/20 text-cyan-400 border-cyan-500/40';
                  if (idx === 0) label = 'WMI';
                } else if (idx < 9) {
                  badgeColor = 'bg-purple-500/20 text-purple-400 border-purple-500/40';
                  if (idx === 3) label = 'VDS';
                } else if (idx === 9) {
                  badgeColor = 'bg-amber-500/20 text-amber-400 border-amber-500/40';
                  label = 'YEAR';
                } else if (idx === 10) {
                  badgeColor = 'bg-blue-500/20 text-blue-400 border-blue-500/40';
                  label = 'PLANT';
                } else {
                  badgeColor = 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40';
                  if (idx === 11) label = 'VIS SEQ';
                }

                return (
                  <div key={idx} className="flex flex-col items-center">
                    <div className={`h-12 w-9 sm:w-11 rounded-lg border flex items-center justify-center font-extrabold text-lg sm:text-xl ${badgeColor}`}>
                      {char}
                    </div>
                    <span className="text-[9px] text-slate-500 font-bold mt-1 h-3">
                      {label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Detailed Specifications Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-start gap-3.5">
              <div className="h-10 w-10 rounded-lg bg-cyan-500/15 border border-cyan-400/30 flex items-center justify-center text-cyan-400 shrink-0">
                <Car className="h-5 w-5" />
              </div>
              <div>
                <span className="text-xs text-slate-400 block">{t('vinManufacturer')}</span>
                <span className="font-bold text-sm text-white mt-0.5 block">{vinInfo.manufacturer}</span>
                <span className="text-[11px] text-slate-500 font-mono mt-0.5 block">{vinInfo.model}</span>
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-start gap-3.5">
              <div className="h-10 w-10 rounded-lg bg-emerald-500/15 border border-emerald-400/30 flex items-center justify-center text-emerald-400 shrink-0">
                <Globe className="h-5 w-5" />
              </div>
              <div>
                <span className="text-xs text-slate-400 block">{t('vinCountry')}</span>
                <span className="font-bold text-sm text-white mt-0.5 block">{vinInfo.country}</span>
                <span className="text-[11px] text-slate-500 font-mono mt-0.5 block">Region / ISO Code</span>
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-start gap-3.5">
              <div className="h-10 w-10 rounded-lg bg-amber-500/15 border border-amber-400/30 flex items-center justify-center text-amber-400 shrink-0">
                <Calendar className="h-5 w-5" />
              </div>
              <div>
                <span className="text-xs text-slate-400 block">{t('vinYear')}</span>
                <span className="font-bold text-sm text-white mt-0.5 block">{vinInfo.year}</span>
                <span className="text-[11px] text-slate-500 font-mono mt-0.5 block">10th Position Code: {vinInfo.rawVin[9]}</span>
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-start gap-3.5">
              <div className="h-10 w-10 rounded-lg bg-purple-500/15 border border-purple-400/30 flex items-center justify-center text-purple-400 shrink-0">
                <Cpu className="h-5 w-5" />
              </div>
              <div>
                <span className="text-xs text-slate-400 block">{t('vinEngine')}</span>
                <span className="font-bold text-sm text-white mt-0.5 block">{vinInfo.engineType}</span>
                <span className="text-[11px] text-slate-500 font-mono mt-0.5 block">VDS 4th-8th Pos</span>
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-start gap-3.5">
              <div className="h-10 w-10 rounded-lg bg-blue-500/15 border border-blue-400/30 flex items-center justify-center text-blue-400 shrink-0">
                <MapPin className="h-5 w-5" />
              </div>
              <div>
                <span className="text-xs text-slate-400 block">{t('vinPlant')}</span>
                <span className="font-bold text-sm text-white mt-0.5 block">{vinInfo.assemblyPlant}</span>
                <span className="text-[11px] text-slate-500 font-mono mt-0.5 block">11th Pos: {vinInfo.rawVin[10]}</span>
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-start gap-3.5">
              <div className="h-10 w-10 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-300 shrink-0">
                <Hash className="h-5 w-5" />
              </div>
              <div>
                <span className="text-xs text-slate-400 block">{t('vinSequential')}</span>
                <span className="font-bold text-sm text-white font-mono mt-0.5 block">{vinInfo.sequentialNumber}</span>
                <span className="text-[11px] text-slate-500 font-mono mt-0.5 block">VIS Serial ID</span>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center text-slate-400 text-xs">
          Invalid VIN format. A valid Vehicle Identification Number must be exactly 17 alphanumeric characters (excluding letters I, O, Q).
        </div>
      )}
    </div>
  );
};
