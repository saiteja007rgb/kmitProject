/** Typed domain wrappers matching docs/API_CONTRACT.md. */
import { httpClient, refreshAccessTokenSingleFlight } from './httpClient';

export const authApi = {
  login: (username, password) =>
    httpClient.post('/auth/login', { username, password }).then((response) => response.data),
  refresh: () => refreshAccessTokenSingleFlight(),
  logout: () => httpClient.post('/auth/logout'),
  getMe: () => httpClient.get('/auth/me').then((response) => response.data),
  changePassword: (currentPassword, newPassword) =>
    httpClient.post('/auth/change-password', {
      current_password: currentPassword,
      new_password: newPassword,
    }),
};

export const adminPeopleApi = {
  getDashboard: () => httpClient.get('/admin/dashboard').then((response) => response.data),
  listCandidates: (params) =>
    httpClient.get('/admin/candidates', { params }).then((response) => response.data),
  createCandidate: (payload) =>
    httpClient.post('/admin/candidates', payload).then((response) => response.data),
  importCandidatesCsv: (file) => {
    const formData = new FormData();
    formData.append('file', file);
    return httpClient
      .post('/admin/candidates/import', formData, { headers: { 'Content-Type': 'multipart/form-data' } })
      .then((response) => response.data);
  },
  updateCandidate: (candidateId, payload) =>
    httpClient.patch(`/admin/candidates/${candidateId}`, payload).then((response) => response.data),
  resetCandidatePassword: (candidateId) =>
    httpClient.post(`/admin/candidates/${candidateId}/reset-password`).then((response) => response.data),
  deleteCandidate: (candidateId) => httpClient.delete(`/admin/candidates/${candidateId}`),

  listBatches: () => httpClient.get('/admin/batches').then((response) => response.data),
  createBatch: (payload) => httpClient.post('/admin/batches', payload).then((response) => response.data),
  updateBatch: (batchId, payload) =>
    httpClient.patch(`/admin/batches/${batchId}`, payload).then((response) => response.data),
  deleteBatch: (batchId) => httpClient.delete(`/admin/batches/${batchId}`),

  listStaff: () => httpClient.get('/admin/staff').then((response) => response.data),
  createStaff: (payload) => httpClient.post('/admin/staff', payload).then((response) => response.data),
  updateStaff: (userId, payload) =>
    httpClient.patch(`/admin/staff/${userId}`, payload).then((response) => response.data),

  listAuditLogs: (params) =>
    httpClient.get('/admin/audit-logs', { params }).then((response) => response.data),
};

export const adminExamsApi = {
  listExams: () => httpClient.get('/admin/exams').then((response) => response.data),
  getExam: (examId) => httpClient.get(`/admin/exams/${examId}`).then((response) => response.data),
  createExam: (payload) => httpClient.post('/admin/exams', payload).then((response) => response.data),
  updateExam: (examId, payload) =>
    httpClient.put(`/admin/exams/${examId}`, payload).then((response) => response.data),
  duplicateExam: (examId) =>
    httpClient.post(`/admin/exams/${examId}/duplicate`).then((response) => response.data),
  deleteExam: (examId) => httpClient.delete(`/admin/exams/${examId}`),
  lifecycleAction: (examId, action) =>
    httpClient.post(`/admin/exams/${examId}/lifecycle`, { action }).then((response) => response.data),
  setResultsPublished: (examId, published) =>
    httpClient.post(`/admin/exams/${examId}/results`, { published }).then((response) => response.data),
  extendAllAttempts: (examId, minutes) =>
    httpClient.post(`/admin/exams/${examId}/extend`, { minutes }).then((response) => response.data),
  importQuestionsFile: (file) => {
    const formData = new FormData();
    formData.append('file', file);
    return httpClient
      .post('/admin/questions/import', formData, { headers: { 'Content-Type': 'multipart/form-data' } })
      .then((response) => response.data);
  },

  listEnrollments: (examId) =>
    httpClient.get(`/admin/exams/${examId}/enrollments`).then((response) => response.data),
  addEnrollments: (examId, payload) =>
    httpClient.post(`/admin/exams/${examId}/enrollments`, payload).then((response) => response.data),
  updateEnrollment: (examId, candidateId, extraMinutes) =>
    httpClient.patch(`/admin/exams/${examId}/enrollments/${candidateId}`, { extra_minutes: extraMinutes }),
  removeEnrollment: (examId, candidateId) =>
    httpClient.delete(`/admin/exams/${examId}/enrollments/${candidateId}`),
};

export const adminMonitorApi = {
  getLiveBoard: (examId) =>
    httpClient.get(`/admin/exams/${examId}/live`).then((response) => response.data),
  getAttemptDetail: (attemptId) =>
    httpClient.get(`/admin/attempts/${attemptId}`).then((response) => response.data),
  fetchSnapshotBlob: (snapshotId) =>
    httpClient.get(`/admin/snapshots/${snapshotId}`, { responseType: 'blob' }).then((response) => response.data),
  extendAttempt: (attemptId, minutes) =>
    httpClient.post(`/admin/attempts/${attemptId}/extend`, { minutes }).then((response) => response.data),
  forceSubmitAttempt: (attemptId) =>
    httpClient.post(`/admin/attempts/${attemptId}/force-submit`).then((response) => response.data),
  resetAttempt: (attemptId) => httpClient.post(`/admin/attempts/${attemptId}/reset`),

  listAnnouncements: (examId) =>
    httpClient.get(`/admin/exams/${examId}/announcements`).then((response) => response.data),
  sendAnnouncement: (examId, message) =>
    httpClient.post(`/admin/exams/${examId}/announcements`, { message }).then((response) => response.data),

  getLeaderboard: (examId) =>
    httpClient.get(`/admin/exams/${examId}/leaderboard`).then((response) => response.data),
  runCollusionScan: (examId) =>
    httpClient.post(`/admin/exams/${examId}/collusion-scan`).then((response) => response.data),
  listCollusionFlags: (examId) =>
    httpClient.get(`/admin/exams/${examId}/collusion-flags`).then((response) => response.data),
  getAnalytics: (examId) =>
    httpClient.get(`/admin/exams/${examId}/analytics`).then((response) => response.data),
  downloadResultsCsv: (examId) =>
    httpClient.get(`/admin/exams/${examId}/results.csv`, { responseType: 'blob' }).then((response) => response.data),

  listGradingQueue: (examId, pendingOnly = true) =>
    httpClient
      .get(`/admin/exams/${examId}/grading-queue`, { params: { pending_only: pendingOnly } })
      .then((response) => response.data),
  gradeAnswer: (answerId, awardedMarks, feedback) =>
    httpClient
      .post(`/admin/answers/${answerId}/grade`, { awarded_marks: awardedMarks, feedback: feedback || null })
      .then((response) => response.data),
};

export const candidateApi = {
  listEnrolledExams: () => httpClient.get('/candidate/exams').then((response) => response.data),
  startOrResumeExam: (examId) =>
    httpClient.post(`/candidate/exams/${examId}/start`, {}).then((response) => response.data),
  getAttempt: (attemptId) =>
    httpClient.get(`/candidate/attempts/${attemptId}`).then((response) => response.data),
  heartbeat: (attemptId) =>
    httpClient.post(`/candidate/attempts/${attemptId}/heartbeat`).then((response) => response.data),
  saveAnswer: (attemptId, questionId, responseValue, isFlagged, version) =>
    httpClient
      .put(`/candidate/attempts/${attemptId}/answers/${questionId}`, {
        response: responseValue,
        is_flagged: isFlagged,
        version,
      })
      .then((response) => response.data),
  submitAttempt: (attemptId) =>
    httpClient.post(`/candidate/attempts/${attemptId}/submit`).then((response) => response.data),
  recordEvent: (attemptId, kind, detail = null) =>
    httpClient
      .post(`/candidate/attempts/${attemptId}/events`, { kind, detail })
      .then((response) => response.data),
  uploadSnapshot: (attemptId, jpegBlob, reason, faceCount) => {
    const formData = new FormData();
    formData.append('image', jpegBlob, 'frame.jpg');
    formData.append('reason', reason);
    formData.append('face_count', String(faceCount));
    return httpClient.post(`/candidate/attempts/${attemptId}/snapshots`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  runCode: (attemptId, questionId, language, code, customInput = null) =>
    httpClient
      .post(`/candidate/attempts/${attemptId}/code/run`, {
        question_id: questionId,
        language,
        code,
        custom_input: customInput,
      })
      .then((response) => response.data),
  getResult: (attemptId) =>
    httpClient.get(`/candidate/attempts/${attemptId}/result`).then((response) => response.data),
};
