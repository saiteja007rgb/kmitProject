/**
 * In-browser webcam proctoring powered by MediaPipe BlazeFace (100% local WASM + model, zero CDN).
 * Runs face detection at ~2 fps, reports sustained integrity violations with 20s cooldowns,
 * and captures lightweight 320x240 JPEG snapshots (<200 KB) periodically and on violations.
 */
import { useEffect, useRef, useState } from 'react';

const DETECT_INTERVAL_MS = 500;
const NO_FACE_THRESHOLD_MS = 5000;
const LOOKING_AWAY_THRESHOLD_MS = 4000;
const COOLDOWN_MS = 20000;
const PERIODIC_SNAPSHOT_MS = 30000;
const MAX_SNAPSHOT_BYTES = 195 * 1024;

function isLookingAway(detection) {
  const keypoints = detection?.keypoints;
  if (!keypoints || keypoints.length < 3) return false;
  const rightEye = keypoints[0];
  const leftEye = keypoints[1];
  const noseTip = keypoints[2];
  const eyeDistance = Math.hypot(leftEye.x - rightEye.x, leftEye.y - rightEye.y);
  if (eyeDistance < 0.02) return false;
  const eyeMidX = (leftEye.x + rightEye.x) / 2;
  const normalizedYaw = Math.abs(noseTip.x - eyeMidX) / eyeDistance;
  return normalizedYaw > 0.38;
}

function captureSnapshotBlob(videoElement, canvasElement) {
  return new Promise((resolve) => {
    if (!videoElement || videoElement.readyState < 2) {
      resolve(null);
      return;
    }
    const width = 320;
    const height = 240;
    canvasElement.width = width;
    canvasElement.height = height;
    const ctx = canvasElement.getContext('2d');
    if (!ctx) {
      resolve(null);
      return;
    }
    ctx.drawImage(videoElement, 0, 0, width, height);
    canvasElement.toBlob(
      (blob) => {
        if (!blob || blob.size > MAX_SNAPSHOT_BYTES) {
          canvasElement.toBlob((smaller) => resolve(smaller), 'image/jpeg', 0.4);
          return;
        }
        resolve(blob);
      },
      'image/jpeg',
      0.6
    );
  });
}

export function useWebcamProctor({
  enabled,
  reportViolations = true,
  onViolation,
  onSnapshot,
}) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const onViolationRef = useRef(onViolation);
  const onSnapshotRef = useRef(onSnapshot);
  onViolationRef.current = onViolation;
  onSnapshotRef.current = onSnapshot;

  const [cameraState, setCameraState] = useState('idle'); // idle | loading | active | denied | error
  const [detectorReady, setDetectorReady] = useState(false);
  const [faceCount, setFaceCount] = useState(0);
  const [gazeStatus, setGazeStatus] = useState('ok'); // ok | no_face | multiple_faces | looking_away
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (!enabled) {
      setCameraState('idle');
      return undefined;
    }

    let cancelled = false;
    let stream = null;
    let detector = null;
    let detectTimer = null;
    let snapshotTimer = null;
    let latestFaceCount = 0;

    let noFaceSince = null;
    let lookingAwaySince = null;
    const lastReportedByKind = new Map();

    if (!canvasRef.current) {
      canvasRef.current = document.createElement('canvas');
    }

    const maybeReportViolation = async (kind, detail, currentFaces) => {
      if (!reportViolations) return;
      const now = Date.now();
      const last = lastReportedByKind.get(kind) || 0;
      if (now - last < COOLDOWN_MS) return;
      lastReportedByKind.set(kind, now);

      onViolationRef.current?.(kind, detail);
      if (onSnapshotRef.current && videoRef.current) {
        const blob = await captureSnapshotBlob(videoRef.current, canvasRef.current);
        if (blob && !cancelled) {
          onSnapshotRef.current(blob, 'violation', currentFaces);
        }
      }
    };

    async function start() {
      setCameraState('loading');
      setErrorMessage('');

      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraState('error');
        setErrorMessage('Camera API is not supported in this browser.');
        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
          audio: false,
        });
      } catch (error) {
        if (!cancelled) {
          setCameraState('denied');
          setErrorMessage(error?.message || 'Camera permission was denied.');
        }
        return;
      }

      if (cancelled) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.addEventListener('ended', () => {
          if (!cancelled) {
            setCameraState('error');
            setErrorMessage('Camera stream was interrupted.');
            maybeReportViolation('camera_off', 'Camera track ended mid-exam', 0);
          }
        });
      }

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setCameraState('active');

      // Dynamically load MediaPipe FaceDetector from locally hosted WASM + TFLite model.
      try {
        const vision = await import('@mediapipe/tasks-vision');
        const fileset = await vision.FilesetResolver.forVisionTasks('/mediapipe/wasm');
        detector = await vision.FaceDetector.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: '/models/blaze_face_short_range.tflite' },
          runningMode: 'VIDEO',
          minDetectionConfidence: 0.5,
        });
        if (!cancelled) setDetectorReady(true);
      } catch (error) {
        // Camera stays active even if WASM fails on a restricted browser; snapshots still work.
        console.warn('MediaPipe FaceDetector initialization failed:', error);
      }

      detectTimer = window.setInterval(() => {
        if (cancelled || !detector || !videoRef.current || videoRef.current.readyState < 2) return;
        try {
          const result = detector.detectForVideo(videoRef.current, performance.now());
          const detections = result?.detections || [];
          const count = detections.length;
          latestFaceCount = count;
          setFaceCount(count);

          const now = Date.now();
          if (count === 0) {
            lookingAwaySince = null;
            setGazeStatus('no_face');
            if (!noFaceSince) noFaceSince = now;
            if (now - noFaceSince >= NO_FACE_THRESHOLD_MS) {
              maybeReportViolation('no_face', 'No face visible in camera frame', 0);
            }
          } else if (count > 1) {
            noFaceSince = null;
            lookingAwaySince = null;
            setGazeStatus('multiple_faces');
            maybeReportViolation('multiple_faces', `${count} faces detected in camera frame`, count);
          } else {
            noFaceSince = null;
            if (isLookingAway(detections[0])) {
              setGazeStatus('looking_away');
              if (!lookingAwaySince) lookingAwaySince = now;
              if (now - lookingAwaySince >= LOOKING_AWAY_THRESHOLD_MS) {
                maybeReportViolation('looking_away', 'Sustained head turn away from screen', 1);
              }
            } else {
              lookingAwaySince = null;
              setGazeStatus('ok');
            }
          }
        } catch {
          // Ignore occasional frame decode glitches.
        }
      }, DETECT_INTERVAL_MS);

      if (onSnapshotRef.current) {
        snapshotTimer = window.setInterval(async () => {
          if (cancelled || !videoRef.current) return;
          const blob = await captureSnapshotBlob(videoRef.current, canvasRef.current);
          if (blob && !cancelled) {
            onSnapshotRef.current?.(blob, 'periodic', latestFaceCount);
          }
        }, PERIODIC_SNAPSHOT_MS);
      }
    }

    start();

    return () => {
      cancelled = true;
      window.clearInterval(detectTimer);
      window.clearInterval(snapshotTimer);
      detector?.close?.();
      stream?.getTracks().forEach((track) => track.stop());
      setDetectorReady(false);
    };
  }, [enabled, reportViolations]);

  return {
    videoRef,
    cameraState,
    detectorReady,
    faceCount,
    gazeStatus,
    errorMessage,
  };
}

