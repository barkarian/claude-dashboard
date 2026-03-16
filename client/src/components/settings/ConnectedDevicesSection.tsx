import { useState, useEffect, useRef, useCallback } from 'react';
import QRCode from 'qrcode';
import { Button } from '../ui/button.tsx';
import api from '../../utils/api.ts';

interface Device {
  id: string;
  deviceName: string;
  platform: 'ios' | 'android';
  pairedAt: string;
  lastActive: string | null;
  notificationPrefs: { chatReply: boolean };
}

interface PairingData {
  token: string;
  shortCode: string;
  expiresIn: number;
}

export default function ConnectedDevicesSection() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPairing, setShowPairing] = useState(false);
  const [pairingData, setPairingData] = useState<PairingData | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const tunnelDomain = 'claw-dev.com';
  const apiSubdomain = 'tunnel-api';

  const fetchDevices = useCallback(async () => {
    try {
      const data = await api.get<{ devices: Device[] }>('/api/devices');
      setDevices(data.devices);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDevices();
  }, [fetchDevices]);

  // Auto-refresh pairing QR every 50 seconds
  useEffect(() => {
    if (!showPairing) {
      if (refreshTimer.current) {
        clearInterval(refreshTimer.current);
        refreshTimer.current = null;
      }
      return;
    }

    generatePairing();
    refreshTimer.current = setInterval(generatePairing, 50_000);

    return () => {
      if (refreshTimer.current) clearInterval(refreshTimer.current);
    };
  }, [showPairing]);

  async function generatePairing() {
    try {
      const data = await api.post<PairingData>('/api/devices/generate-pairing');
      setPairingData(data);

      const pairUrl = `https://${apiSubdomain}.${tunnelDomain}/pair?token=${data.token}`;
      const dataUrl = await QRCode.toDataURL(pairUrl, {
        width: 256,
        margin: 2,
        color: { dark: '#ffffff', light: '#00000000' },
      });
      setQrDataUrl(dataUrl);
    } catch (err) {
      console.error('Failed to generate pairing:', err);
    }
  }

  async function handleDelete(deviceId: string) {
    setDeleting(deviceId);
    try {
      await api.delete(`/api/devices/${deviceId}`);
      setDevices((prev) => prev.filter((d) => d.id !== deviceId));
    } catch (err) {
      console.error('Failed to delete device:', err);
    } finally {
      setDeleting(null);
    }
  }

  if (loading) {
    return (
      <div className="bg-bg-surface border border-border rounded-xl p-6">
        <div className="animate-pulse space-y-3">
          <div className="h-5 bg-border rounded w-40" />
          <div className="h-4 bg-border rounded w-56" />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-bg-surface border border-border rounded-xl p-5">
      <h3 className="text-base font-semibold text-text mb-4 flex items-center gap-2">
        <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" />
        </svg>
        Connected Devices
      </h3>

      {/* Device list */}
      {devices.length > 0 && (
        <div className="space-y-3 mb-4">
          {devices.map((device) => (
            <div key={device.id} className="flex items-center justify-between p-3 bg-bg rounded-lg border border-border">
              <div className="flex items-center gap-3">
                <span className="text-lg">
                  {device.platform === 'ios' ? '\u{F8FF}' : '\u{1F4F1}'}
                </span>
                <div>
                  <p className="text-sm font-medium text-text">{device.deviceName}</p>
                  <p className="text-xs text-text-muted">
                    Paired {new Date(device.pairedAt).toLocaleDateString()}
                    {device.lastActive && ` \u00B7 Last active ${new Date(device.lastActive).toLocaleDateString()}`}
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleDelete(device.id)}
                disabled={deleting === device.id}
                className="text-error hover:text-error"
              >
                {deleting === device.id ? 'Removing...' : 'Remove'}
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Add device / pairing */}
      {showPairing ? (
        <div className="space-y-4">
          <div className="flex flex-col items-center gap-3 p-4 bg-bg rounded-lg border border-border">
            {qrDataUrl && (
              <img src={qrDataUrl} alt="Pair device QR code" className="w-48 h-48" />
            )}
            {pairingData && (
              <div className="text-center">
                <p className="text-xs text-text-muted mb-1">Or enter this code manually:</p>
                <p className="text-2xl font-mono font-bold text-primary tracking-widest">
                  {pairingData.shortCode}
                </p>
              </div>
            )}
            <p className="text-xs text-text-muted text-center">
              Scan with the Claw Dev mobile app or enter the code. Refreshes automatically.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowPairing(false)}
            className="w-full"
          >
            Cancel
          </Button>
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowPairing(true)}
          className="w-full"
        >
          Add Device
        </Button>
      )}
    </div>
  );
}
