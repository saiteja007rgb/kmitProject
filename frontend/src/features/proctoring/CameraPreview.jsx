import React from 'react';
import { Camera, CameraOff } from 'lucide-react';
import { Badge } from '../../components/ui';

const GAZE_BADGES = {
  ok: { label: 'Face verified', tone: 'success' },
  no_face: { label: 'No face detected', tone: 'danger' },
  multiple_faces: { label: 'Multiple faces', tone: 'danger' },
  looking_away: { label: 'Looking away', tone: 'warning' },
};

export function CameraPreview({ videoRef, cameraState, detectorReady, gazeStatus, errorMessage, compact = false }) {
  const statusBadge =
    cameraState !== 'active'
      ? { label: cameraState === 'loading' ? 'Starting camera…' : 'Camera unavailable', tone: 'danger' }
      : detectorReady
        ? GAZE_BADGES[gazeStatus] || GAZE_BADGES.ok
        : { label: 'Camera active', tone: 'info' };

  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-950 overflow-hidden">
      <div className={`relative w-full ${compact ? 'aspect-[4/3]' : 'aspect-video'} bg-zinc-900 flex items-center justify-center`}>
        <video
          ref={videoRef}
          muted
          playsInline
          className={`h-full w-full object-cover -scale-x-100 ${cameraState === 'active' ? 'block' : 'hidden'}`}
        />
        {cameraState !== 'active' && (
          <div className="flex flex-col items-center gap-2 px-4 text-center text-zinc-400">
            {cameraState === 'loading' ? <Camera className="h-6 w-6 animate-pulse" /> : <CameraOff className="h-6 w-6 text-red-400" />}
            <span className="text-xs">{errorMessage || 'Initializing webcam…'}</span>
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 bg-white dark:bg-zinc-900 px-2.5 py-2 border-t border-zinc-200 dark:border-zinc-800">
        <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">Proctoring</span>
        <Badge tone={statusBadge.tone} dot>
          {statusBadge.label}
        </Badge>
      </div>
    </div>
  );
}
