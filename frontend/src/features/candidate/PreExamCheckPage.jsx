import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Play, XCircle } from 'lucide-react';
import { candidateApi } from '../../api/endpoints';
import { extractApiError } from '../../lib/format';
import { Button, Card, Checkbox, Spinner } from '../../components/ui';
import { useToast } from '../../components/ui/ToastProvider';
import { useWebcamProctor } from '../proctoring/useWebcamProctor';
import { CameraPreview } from '../proctoring/CameraPreview';

function CheckRow({ label, ok, detail }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b last:border-b-0 border-zinc-200 dark:border-zinc-800 text-sm">
      <div>
        <div className="font-medium text-zinc-800 dark:text-zinc-200">{label}</div>
        {detail && <div className="text-xs text-zinc-500 dark:text-zinc-400">{detail}</div>}
      </div>
      {ok ? (
        <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
      ) : (
        <XCircle className="h-4 w-4 text-red-500 shrink-0" />
      )}
    </div>
  );
}

export default function PreExamCheckPage() {
  const { examId } = useParams();
  const navigate = useNavigate();
  const { notify } = useToast();

  const [exam, setExam] = useState(null);
  const [loading, setLoading] = useState(true);
  const [agreed, setAgreed] = useState(false);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    candidateApi
      .listEnrolledExams()
      .then((list) => {
        const found = list.find((item) => item.id === examId);
        if (!found) {
          notify('Exam not found in your enrollments.', 'danger');
          navigate('/candidate', { replace: true });
          return;
        }
        setExam(found);
      })
      .catch((error) => notify(extractApiError(error), 'danger'))
      .finally(() => setLoading(false));
  }, [examId, navigate, notify]);

  const cameraCheck = useWebcamProctor({
    enabled: Boolean(exam?.require_webcam),
    reportViolations: false,
  });

  if (loading || !exam) {
    return (
      <div className="py-16 flex justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  const isOnline = navigator.onLine;
  const fullscreenSupported = Boolean(document.documentElement.requestFullscreen);
  const cameraPassed = !exam.require_webcam || cameraCheck.cameraState === 'active';
  const canStart = agreed && isOnline && cameraPassed && exam.status === 'live';

  const handleStartExam = async () => {
    setStarting(true);
    try {
      if (exam.require_fullscreen && fullscreenSupported && !document.fullscreenElement) {
        await document.documentElement.requestFullscreen().catch(() => {});
      }
      const attemptState = await candidateApi.startOrResumeExam(exam.id);
      navigate(`/candidate/attempts/${attemptState.attempt_id}`, { replace: true });
    } catch (error) {
      notify(extractApiError(error, 'Could not start exam.'), 'danger');
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <button
        type="button"
        onClick={() => navigate('/candidate')}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to exams
      </button>

      <div>
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">{exam.title}</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Complete the system readiness checks before your timer starts.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card className="p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-2">
            System checks
          </h2>
          <CheckRow label="Network connectivity" ok={isOnline} detail={isOnline ? 'Connected to ExamPulse' : 'Offline'} />
          <CheckRow
            label="Fullscreen support"
            ok={!exam.require_fullscreen || fullscreenSupported}
            detail={exam.require_fullscreen ? 'Fullscreen mode will activate on start' : 'Optional for this exam'}
          />
          {exam.require_webcam && (
            <CheckRow
              label="Webcam & face detection"
              ok={cameraCheck.cameraState === 'active'}
              detail={
                cameraCheck.cameraState === 'active'
                  ? cameraCheck.detectorReady
                    ? cameraCheck.faceCount === 1
                      ? 'Face detected clearly'
                      : 'Position your face in front of the camera'
                    : 'Camera active (loading face model…)'
                  : cameraCheck.errorMessage || 'Allow camera permission in your browser'
              }
            />
          )}
        </Card>

        {exam.require_webcam ? (
          <CameraPreview
            videoRef={cameraCheck.videoRef}
            cameraState={cameraCheck.cameraState}
            detectorReady={cameraCheck.detectorReady}
            gazeStatus={cameraCheck.gazeStatus}
            errorMessage={cameraCheck.errorMessage}
          />
        ) : (
          <Card className="p-4 flex flex-col justify-center">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Proctoring mode
            </h2>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
              Webcam proctoring is disabled for this exam. Tab switches and clipboard actions remain monitored.
            </p>
          </Card>
        )}
      </div>

      <Card className="p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Examination rules</h2>
          <ul className="mt-2 space-y-1.5 text-sm text-zinc-600 dark:text-zinc-400 list-disc pl-5">
            <li>Duration: {exam.duration_minutes} minutes, tracked strictly by server UTC time.</li>
            <li>Answers are saved continuously and survive page reloads or brief disconnects.</li>
            <li>Switching tabs, exiting fullscreen, or pasting content is logged for invigilator review.</li>
          </ul>
        </div>

        <Checkbox
          label="I understand the examination rules and am ready to begin."
          checked={agreed}
          onChange={setAgreed}
        />

        <div className="flex justify-end">
          <Button disabled={!canStart} loading={starting} onClick={handleStartExam}>
            <Play className="h-4 w-4" />
            Begin examination
          </Button>
        </div>
      </Card>
    </div>
  );
}
