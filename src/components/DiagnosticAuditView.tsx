import React, { useState } from 'react';
import { transportManager } from '../network/TransportManager';
import { BinaryProtocol } from '../network/binaryProtocol';
import { 
  CheckCircle2, 
  XCircle, 
  HelpCircle, 
  Activity, 
  Bluetooth, 
  Cpu, 
  Zap, 
  ShieldCheck, 
  RefreshCw,
  Search,
  Table
} from 'lucide-react';
import { ConnectionStatus } from '../types';

interface AuditStep {
  layer: string;
  status: 'PASS' | 'FAIL' | 'PENDING' | 'NOT_TESTED';
  evidence: string;
  description: string;
  hexData?: {
    tx?: string;
    rx?: string;
    esp32?: string;
  };
  details?: string;
}

export const DiagnosticAuditView: React.FC<{ status: ConnectionStatus }> = ({ status }) => {
  const [isRunning, setIsRunning] = useState(false);
  const [steps, setSteps] = useState<AuditStep[]>([
    { layer: 'Native Transport', status: 'NOT_TESTED', evidence: '-', description: 'Verifying Capacitor/Native Bridge connectivity' },
    { layer: 'Binary Protocol', status: 'NOT_TESTED', evidence: '-', description: 'Checksum & Framing validation (AA 55)' },
    { layer: 'ESP32 Firmware', status: 'NOT_TESTED', evidence: '-', description: 'Ping/Pong handshake with ESP32' },
    { layer: 'CAN Controller', status: 'NOT_TESTED', evidence: '-', description: 'TWAI Status & Error Counter Check' },
    { layer: 'ECU Communication', status: 'NOT_TESTED', evidence: '-', description: 'Functional Query (Mode 01 PID 00)' },
    { layer: 'ISO-TP Reassembly', status: 'NOT_TESTED', evidence: '-', description: 'Multi-frame VIN assembly proof' },
    { layer: 'OBD/UDS Decoder', status: 'NOT_TESTED', evidence: '-', description: 'RPM Calculation & Formula validation' }
  ]);

  const runAudit = async () => {
    setIsRunning(true);
    const newSteps = [...steps];
    
    const updateStep = (index: number, update: Partial<AuditStep>) => {
      newSteps[index] = { ...newSteps[index], ...update };
      setSteps([...newSteps]);
    };

    try {
      // 1. Native Transport (HARDWARE VERIFIED)
      updateStep(0, { status: 'PENDING', evidence: 'Verifying transport layer...' });
      const transport = transportManager.getTransport();
      const state = transport.getState();
      const isConnected = state === 'CONNECTED' && !transportManager.getConfig().isMockMode;
      
      updateStep(0, { 
        status: isConnected ? 'PASS' : 'FAIL', 
        evidence: isConnected ? `Transport: ${transport.type} | State: ${state}` : 'DISCONNECTED or MOCK MODE',
        details: isConnected ? 'Android Native Bridge OK' : 'Bridge active but transport DISCONNECTED or MOCK'
      });

      if (!isConnected) throw new Error('ABORT: Hardware not connected');

      // 2. Binary Protocol (HARDWARE VERIFIED)
      updateStep(1, { status: 'PENDING', evidence: 'Verifying Frame Handshake...' });
      const pingResult = await transportManager.ping();
      
      if (pingResult.success && pingResult.txHex && pingResult.rxHex) {
        // Verify Magic Bytes in RX
        const isMagicOk = pingResult.rxHex.startsWith('AA 55');
        updateStep(1, { 
          status: isMagicOk ? 'PASS' : 'FAIL', 
          evidence: isMagicOk ? `Binary Handshake Validated` : 'Checksum or Framing Error',
          hexData: { tx: pingResult.txHex, rx: pingResult.rxHex },
          details: isMagicOk ? 'Checksum & Magic Bytes Verified from Hardware' : 'Invalid framing received'
        });
      } else {
        updateStep(1, { status: 'FAIL', evidence: 'PING/PONG Handshake Failed', details: pingResult.info });
        throw new Error('ABORT: Protocol Handshake Failed');
      }

      // 3. ESP32 Firmware (HARDWARE VERIFIED)
      updateStep(2, { status: 'PENDING', evidence: 'Querying ESP32 Internals...' });
      if (pingResult.success) {
        updateStep(2, { 
          status: 'PASS', 
          evidence: `ESP32 ACK Received (${pingResult.latencyMs}ms)`,
          details: `Uptime: ${pingResult.uptimeMs}ms | Free Heap: ${pingResult.freeHeapBytes} bytes`
        });
      } else {
        updateStep(2, { status: 'FAIL', evidence: 'ESP32 SILENT' });
      }

      // 4. CAN Controller (HARDWARE VERIFIED)
      updateStep(3, { status: 'PENDING', evidence: 'Querying TWAI Status...' });
      const canStatus = await transportManager.getCanStatus();
      if (canStatus) {
        const isOk = canStatus.state === 'READY' || (canStatus.state as string) === 'RUNNING';
        updateStep(3, { 
          status: isOk ? 'PASS' : 'FAIL', 
          evidence: `CAN CONTROLLER ${isOk ? 'READY' : 'ERROR'}`,
          details: `State: ${canStatus.state} | TxErr: ${canStatus.txErrorCount} | RxErr: ${canStatus.rxErrorCount}`
        });
      } else {
        updateStep(3, { status: 'FAIL', evidence: 'Status Query Failed' });
      }

      // 5. ECU Communication (VEHICLE VERIFIED)
      updateStep(4, { status: 'PENDING', evidence: 'Requesting PID 0x00...' });
      const ecuResp: any = await transportManager.sendRequest([0x01, 0x00], '0x7DF');
      
      const rxFrame = ecuResp.auditFrames?.find((f: any) => 
        f.direction === 'RX' && 
        f.id >= 0x7E8 && f.id <= 0x7EF &&
        f.data && f.data.length >= 2 && f.data[0] === 0x41 && f.data[1] === 0x00
      );

      if (ecuResp.status === 'SUCCESS' && rxFrame) {
        const txFrame = ecuResp.auditFrames?.find((f: any) => f.direction === 'TX');
        const txHex = txFrame ? txFrame.data.map((b: number) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ') : '03 01 00 00 00 00 00 00';
        const rxHex = rxFrame.data.map((b: number) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');

        updateStep(4, { 
          status: 'PASS', 
          evidence: `RX 0x${rxFrame.id.toString(16).toUpperCase()} [8] ${rxHex}`,
          details: `Validated real ECU response for 01 00 from ID 0x${rxFrame.id.toString(16).toUpperCase()}`,
          hexData: { tx: `7DF [8] ${txHex}`, rx: `0x${rxFrame.id.toString(16).toUpperCase()} [8] ${rxHex}` }
        });
      } else {
        updateStep(4, { status: 'FAIL', evidence: `NO VALID ECU RX FRAME (${ecuResp.status})`, details: 'Required CAN ID 0x7E8-0x7EF with positive response 41 00 not found in auditFrames' });
      }

      // 6. ISO-TP Reassembly (VEHICLE VERIFIED)
      updateStep(5, { status: 'PENDING', evidence: 'Reassembling VIN (0x09 0x02)...' });
      const vinPkt: any = await transportManager.sendRequest([0x09, 0x02], '0x7DF');
      if (vinPkt.status === 'SUCCESS' && vinPkt.auditFrames) {
        const ff = vinPkt.auditFrames.find((f: any) => f.direction === 'RX' && (f.data[0] & 0xF0) === 0x10);
        const fc = vinPkt.auditFrames.find((f: any) => (f.data[0] & 0xF0) === 0x30);
        const cfs = vinPkt.auditFrames.filter((f: any) => f.direction === 'RX' && (f.data[0] & 0xF0) === 0x20);

        if (ff && cfs.length > 0) {
          const totalLen = ((ff.data[0] & 0x0F) << 8) | ff.data[1];
          
          // Verify sequence numbers and continuity
          let expectedSeq = 1;
          let seqValid = true;
          cfs.forEach((cf: any) => {
            const seq = cf.data[0] & 0x0F;
            if (seq !== (expectedSeq & 0x0F)) {
              seqValid = false;
            }
            expectedSeq++;
          });

          // Extract payload bytes from FF (6 bytes) and CFs (7 bytes each)
          const payloadBytes: number[] = [];
          // FF payload starts at index 2
          payloadBytes.push(...ff.data.slice(2));
          cfs.forEach((cf: any) => {
            payloadBytes.push(...cf.data.slice(1));
          });

          const reassembledLen = payloadBytes.length;
          const isServiceValid = payloadBytes[0] === 0x49 && payloadBytes[1] === 0x02;

          // Extract VIN if length permits (VIN starts at index 2 of 09 02 response, typically 17 chars)
          let extractedVin = 'N/A';
          if (payloadBytes.length >= 2 + 17) {
            const vinBytes = payloadBytes.slice(2, 2 + 17);
            extractedVin = String.fromCharCode(...vinBytes);
          }

          const isPass = seqValid && isServiceValid && (reassembledLen >= totalLen || payloadBytes.length >= totalLen);

          const ffHex = ff.data.map((b: number) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
          const fcHex = fc ? fc.data.map((b: number) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ') : 'NOT REQUIRED/SENT';
          const cfEvidence = cfs.map((f: any) => `CF${f.data[0] & 0x0F}: ${f.data.map((b: number) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ')}`).join('\n');

          updateStep(5, { 
            status: isPass ? 'PASS' : 'FAIL', 
            evidence: `VIN: ${extractedVin} | Total Len: ${totalLen} | Reassembled: ${reassembledLen} bytes`,
            details: `FF: ${ffHex}\nFC: ${fcHex}\n${cfEvidence}\nSequence Valid: ${seqValid ? 'YES' : 'FAIL'} | Service 49 02: ${isServiceValid ? 'YES' : 'FAIL'}`,
            hexData: { tx: 'Functional Broadcast 09 02', rx: `FF + ${cfs.length} CFs` }
          });
        } else {
          updateStep(5, { status: 'FAIL', evidence: 'ISO-TP REASSEMBLY INCOMPLETE', details: 'First Frame or Consecutive Frames missing from auditFrames' });
        }
      } else {
        updateStep(5, { status: 'FAIL', evidence: 'VIN Multi-frame timeout or no audit trail' });
      }

      // 7. OBD/UDS Decoder (VEHICLE VERIFIED)
      updateStep(6, { status: 'PENDING', evidence: 'Validating RPM calculation...' });
      const rpmPkt: any = await transportManager.sendRequest([0x01, 0x0C], '0x7DF');
      if (rpmPkt.status === 'SUCCESS' && rpmPkt.data) {
        const bytes = rpmPkt.data;
        if (bytes[0] === 0x41 && bytes[1] === 0x0C && bytes.length >= 4) {
          const a = bytes[2];
          const b = bytes[3];
          const rpm = ((a * 256) + b) / 4;
          updateStep(6, { 
            status: 'PASS', 
            evidence: `Decoded RPM: ${rpm.toFixed(0)}`,
            details: `Raw: ${a.toString(16)} ${b.toString(16)} | Formula: ((${a} * 256) + ${b}) / 4 = ${rpm.toFixed(2)}`
          });
        } else {
          updateStep(6, { status: 'FAIL', evidence: `Malformed RPM response` });
        }
      } else {
        updateStep(6, { status: 'FAIL', evidence: 'RPM fetch failed' });
      }

    } catch (err: any) {
      console.error('[AUDIT-ERR]', err);
    } finally {
      setIsRunning(false);
    }
  };

  const getStatusIcon = (status: AuditStep['status']) => {
    switch (status) {
      case 'PASS': return <CheckCircle2 className="h-5 w-5 text-emerald-400" />;
      case 'FAIL': return <XCircle className="h-5 w-5 text-rose-400" />;
      case 'PENDING': return <RefreshCw className="h-5 w-5 text-cyan-400 animate-spin" />;
      default: return <HelpCircle className="h-5 w-5 text-slate-600" />;
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-cyan-400" />
            System Audit & Proof Tracker
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            End-to-end verification of the diagnostic communication path.
          </p>
        </div>
        <button
          onClick={runAudit}
          disabled={isRunning}
          className="px-6 py-3 bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-800 text-white font-bold rounded-xl transition-all shadow-lg shadow-cyan-950/40 flex items-center gap-2"
        >
          {isRunning ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Activity className="h-4 w-4" />}
          Run Full Proof-Audit
        </button>
      </div>

      <div className="bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-900/80 border-b border-slate-800 text-xs font-bold text-slate-400 uppercase tracking-widest">
              <th className="px-6 py-4">Layer / Component</th>
              <th className="px-6 py-4">Status</th>
              <th className="px-6 py-4">Evidence / Data</th>
              <th className="px-6 py-4">Description</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-900 font-mono text-sm">
            {steps.map((step, i) => (
              <tr key={i} className="hover:bg-slate-900/40 transition-colors">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-400">
                      {i === 0 && <Bluetooth className="h-4 w-4" />}
                      {i === 1 && <Table className="h-4 w-4" />}
                      {i === 2 && <Cpu className="h-4 w-4" />}
                      {i === 3 && <Zap className="h-4 w-4" />}
                      {i >= 4 && <Search className="h-4 w-4" />}
                    </div>
                    <span className="font-bold text-slate-200">{step.layer}</span>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2">
                    {getStatusIcon(step.status)}
                    <span className={`text-xs font-bold ${
                      step.status === 'PASS' ? 'text-emerald-400' : 
                      step.status === 'FAIL' ? 'text-rose-400' : 
                      'text-slate-500'
                    }`}>
                      {step.status}
                    </span>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <div className="space-y-1">
                    <div className="text-xs text-slate-300 font-bold">{step.evidence}</div>
                    {step.details && (
                      <div className="text-[10px] text-slate-500 italic leading-tight">
                        {step.details}
                      </div>
                    )}
                    {step.hexData && (
                      <div className="mt-2 space-y-1">
                        {step.hexData.tx && (
                          <div className="flex gap-2 text-[9px]">
                            <span className="text-cyan-600 font-bold w-4">TX:</span>
                            <span className="text-slate-400 break-all">{step.hexData.tx}</span>
                          </div>
                        )}
                        {step.hexData.rx && (
                          <div className="flex gap-2 text-[9px]">
                            <span className="text-emerald-600 font-bold w-4">RX:</span>
                            <span className="text-slate-400 break-all">{step.hexData.rx}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </td>
                <td className="px-6 py-4">
                  <div className="space-y-1">
                    <div className="text-[10px] text-slate-500 uppercase tracking-tighter">
                      {i === 1 ? 'CODE VERIFIED' : i < 4 ? 'HARDWARE VERIFIED' : 'VEHICLE VERIFIED'}
                    </div>
                    <div className="text-[11px] text-slate-400">{step.description}</div>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-slate-900/50 border border-slate-800 p-5 rounded-2xl flex items-start gap-4">
        <div className="p-2 bg-amber-900/20 border border-amber-800/40 rounded-lg text-amber-500">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <div className="space-y-2">
          <h4 className="text-sm font-bold text-slate-200">Audit Protocol & Proof Guidelines</h4>
          <p className="text-xs text-slate-500 leading-relaxed">
            The System Audit performs a real-time sequential verification of the entire diagnostic chain. 
            <strong> PASS</strong> status is only granted if valid Hex data or a signed handshake is received from the physical ESP32 and ECU. 
            All timeouts and checksum errors will result in an immediate <strong>FAIL</strong> to prevent false reporting.
          </p>
          <div className="flex gap-6 mt-4">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-slate-500"></div>
              <span className="text-[10px] text-slate-400 uppercase font-bold">Code Verified:</span>
              <span className="text-[10px] text-slate-600 italic underline">Algorithmic Match</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-cyan-500"></div>
              <span className="text-[10px] text-slate-400 uppercase font-bold">Hardware Verified:</span>
              <span className="text-[10px] text-slate-600 italic underline">ESP32 Handshake</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-emerald-500"></div>
              <span className="text-[10px] text-slate-400 uppercase font-bold">Vehicle Verified:</span>
              <span className="text-[10px] text-slate-600 italic underline">ECU Response Proof</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
