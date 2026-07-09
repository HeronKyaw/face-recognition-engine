const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5050";

export interface HealthResponse {
  status: string;
  checks: { mysql: boolean; chromadb: boolean; opencv: boolean };
  version: string;
}

export interface UserResponse {
  user_id: string;
  name: string;
  metadata?: string;
  face_enrolled: boolean;
  created_at: string;
}

export interface UserListResponse {
  users: UserResponse[];
  total: number;
  page: number;
  page_size: number;
}

export interface UserDeleteResponse {
  success: boolean;
  user_id: string;
  message: string;
  chroma_deleted: boolean;
}

export type LivenessMethod = "frame_burst" | "challenge";

export interface LivenessResult {
  passed: boolean;
  passive_score: number;
  blur_score: number;
  color_score: number;
  blink_detected: boolean;
  frame_diversity_ok: boolean;
  method: LivenessMethod;
  challenge_verified?: boolean;
  challenge_expected_count?: number;
  challenge_actual_count?: number;
  message: string;
}

export interface ChallengeStep {
  action: string;
  instruction: string;
}

export interface ChallengeInitResponse {
  challenge_id: string;
  steps: ChallengeStep[];
  total_steps: number;
  expires_at: string;
}

export interface StepVerifyResponse {
  passed: boolean;
  step_index: number;
  next_step_index?: number;
  completed: boolean;
  message: string;
}

export interface EnrollResponse {
  success: boolean;
  user_id: string;
  message: string;
  embedding_stored: boolean;
  liveness?: LivenessResult;
}

export interface VerifyResponse {
  success: boolean;
  user_id?: string;
  name?: string;
  metadata?: string;
  distance?: number;
  message: string;
  liveness?: LivenessResult;
}

export interface VerificationLog {
  id: number;
  user_id?: string;
  device_id?: string;
  distance?: number;
  created_at: string;
}

export interface VerificationLogsResponse {
  logs: VerificationLog[];
  total: number;
  page: number;
  page_size: number;
}

export interface ResetEnrollmentsResponse {
  success: boolean;
  embeddings_removed: number;
  users_reset: number;
  message: string;
}

export interface ResetFaceResponse {
  success: boolean;
  user_id: string;
  message: string;
  embedding_removed: boolean;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(options?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  return res.json();
}

export const api = {
  health: () => request<HealthResponse>("/health"),

  listUsers: (page = 1, pageSize = 20) =>
    request<UserListResponse>(`/api/v1/users?page=${page}&page_size=${pageSize}`),

  getUser: (userId: string) => request<UserResponse>(`/api/v1/users/${userId}`),

  createUser: (data: { user_id: string; name: string; metadata?: string }) =>
    request<UserResponse>("/api/v1/users", { method: "POST", body: JSON.stringify(data) }),

  updateUser: (userId: string, data: { name?: string; metadata?: string }) =>
    request<UserResponse>(`/api/v1/users/${userId}`, { method: "PUT", body: JSON.stringify(data) }),

  deleteUser: (userId: string) =>
    request<UserDeleteResponse>(`/api/v1/users/${userId}`, { method: "DELETE" }),

  initChallenge: () =>
    request<ChallengeInitResponse>("/api/v1/challenge/init", { method: "POST" }),

  verifyChallengeStep: async (challengeId: string, stepIndex: number, frames: File[]) => {
    const form = new FormData();
    form.append("challenge_id", challengeId);
    form.append("step_index", String(stepIndex));
    for (const f of frames) {
      form.append("liveness_frames", f);
    }
    return request<StepVerifyResponse>("/api/v1/challenge/step", { method: "POST", body: form });
  },

  enroll: async (
    userId: string,
    file: File,
    livenessFrames: File[] = [],
    method: LivenessMethod = "frame_burst",
    challengeId?: string
  ) => {
    const form = new FormData();
    form.append("user_id", userId);
    form.append("face_image", file);
    form.append("method", method);
    if (challengeId) form.append("challenge_id", challengeId);
    for (const f of livenessFrames) {
      form.append("liveness_frames", f);
    }
    return request<EnrollResponse>("/api/v1/enroll", { method: "POST", body: form });
  },

  verify: async (
    file: File,
    livenessFrames: File[] = [],
    deviceId?: string,
    method: LivenessMethod = "frame_burst",
    challengeId?: string
  ) => {
    const form = new FormData();
    form.append("face_image", file);
    form.append("method", method);
    if (challengeId) form.append("challenge_id", challengeId);
    for (const f of livenessFrames) {
      form.append("liveness_frames", f);
    }
    if (deviceId) form.append("device_id", deviceId);
    return request<VerifyResponse>("/api/v1/verify", { method: "POST", body: form });
  },

  listLogs: (params?: { user_id?: string; page?: number; page_size?: number }) => {
    const q = new URLSearchParams();
    if (params?.user_id) q.set("user_id", params.user_id);
    q.set("page", String(params?.page ?? 1));
    q.set("page_size", String(params?.page_size ?? 20));
    return request<VerificationLogsResponse>(`/api/v1/verification-logs?${q}`);
  },

  resetEnrollments: () =>
    request<ResetEnrollmentsResponse>("/api/v1/reset-enrollments", { method: "POST" }),

  resetFace: (userId: string) =>
    request<ResetFaceResponse>(`/api/v1/users/${userId}/face`, { method: "DELETE" }),
};
