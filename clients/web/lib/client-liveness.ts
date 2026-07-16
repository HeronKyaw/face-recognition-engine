"use client";

import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import type { ClientLivenessResult } from "./api";

interface LandmarkPoint {
  x: number;
  y: number;
  z: number;
}

const LEFT_EYE = [33, 160, 158, 133, 153, 144];
const RIGHT_EYE = [362, 385, 387, 263, 373, 380];

const BLINK_EAR_THRESHOLD = 0.2;
const MIN_BLINKS_REQUIRED = 1;
const LIVENESS_PASSIVE_THRESHOLD = 0.3;
const LIVENESS_FRAME_DIVERSITY_THRESHOLD = 15.0;

const WASM_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm";
const MODEL_CDN = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

const CHALLENGE_HEAD_TURN_YAW_THRESHOLD = 12.0;
const CHALLENGE_SMILE_THRESHOLD = 0.42;
const CHALLENGE_MOUTH_OPEN_MAR_THRESHOLD = 0.5;
const CHALLENGE_MIN_STEPS = 2;
const CHALLENGE_MAX_STEPS = 4;
const CHALLENGE_MIN_BLINKS = 1;
const CHALLENGE_MAX_BLINKS = 3;

const CHALLENGE_ACTION_POOL = ["blink", "smile", "turn_left", "turn_right", "mouth_open"] as const;
type ChallengeAction = typeof CHALLENGE_ACTION_POOL[number];

export interface ClientChallengeStep {
  action: ChallengeAction;
  instruction: string;
  params: Record<string, unknown>;
}

export class ClientLivenessService {
  private static instance: ClientLivenessService | null = null;
  private static loadingPromise: Promise<ClientLivenessService> | null = null;
  private faceLandmarker: FaceLandmarker | null = null;
  private modelLoaded = false;
  private detecting = false;
  private crashed = false;
  private vision: any = null;

  private constructor() {}

  static async getInstance(): Promise<ClientLivenessService> {
    if (ClientLivenessService.instance?.modelLoaded && !ClientLivenessService.instance?.crashed) {
      return ClientLivenessService.instance;
    }
    if (!ClientLivenessService.loadingPromise) {
      ClientLivenessService.loadingPromise = ClientLivenessService.create();
    }
    return ClientLivenessService.loadingPromise;
  }

  private static async create(): Promise<ClientLivenessService> {
    const service = new ClientLivenessService();
    try {
      service.vision = await FilesetResolver.forVisionTasks(WASM_CDN);
      await service.initLandmarker();
    } catch (err) {
      console.error("Failed to load FaceLandmarker:", err);
    }
    return service;
  }

  private async initLandmarker(): Promise<void> {
    if (!this.vision) return;
    try {
      this.faceLandmarker = await FaceLandmarker.createFromOptions(this.vision, {
        baseOptions: {
          modelAssetPath: MODEL_CDN,
          delegate: "CPU",
        },
        runningMode: "IMAGE",
        numFaces: 1,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false,
      });
      this.modelLoaded = true;
      this.crashed = false;
    } catch (err) {
      console.error("Failed to init FaceLandmarker:", err);
    }
  }

  private async recover(): Promise<void> {
    this.faceLandmarker = null;
    this.modelLoaded = false;
    this.detecting = false;
    await this.initLandmarker();
  }

  get isLoaded(): boolean {
    return this.modelLoaded && this.faceLandmarker !== null && !this.crashed;
  }

  private async toBitmap(input: HTMLVideoElement | HTMLCanvasElement): Promise<ImageBitmap | null> {
    try {
      return await createImageBitmap(input);
    } catch {
      return null;
    }
  }

  async detectFaces(input: HTMLVideoElement | HTMLCanvasElement): Promise<LandmarkPoint[] | null> {
    if (!this.faceLandmarker || !this.modelLoaded || this.detecting || this.crashed) return null;
    const bitmap = await this.toBitmap(input);
    if (!bitmap) return null;
    this.detecting = true;
    try {
      const result = this.faceLandmarker.detect(bitmap);
      if (result.faceLandmarks && result.faceLandmarks.length > 0) {
        const raw = result.faceLandmarks[0] as unknown as LandmarkPoint[];
        return raw;
      }
    } catch {
      this.crashed = true;
      this.recover();
    } finally {
      this.detecting = false;
      bitmap.close();
    }
    return null;
  }

  eyeAspectRatio(landmarks: LandmarkPoint[], eyeIndices: number[], imgW: number, imgH: number): number {
    const pts = eyeIndices.map((i) => ({ x: landmarks[i].x * imgW, y: landmarks[i].y * imgH }));
    const A = Math.hypot(pts[1].x - pts[5].x, pts[1].y - pts[5].y);
    const B = Math.hypot(pts[2].x - pts[4].x, pts[2].y - pts[4].y);
    const C = Math.hypot(pts[0].x - pts[3].x, pts[0].y - pts[3].y);
    if (C === 0) return 0;
    return (A + B) / (2.0 * C);
  }

  computeEarForFrame(landmarks: LandmarkPoint[], imgW: number, imgH: number): number {
    const left = this.eyeAspectRatio(landmarks, LEFT_EYE, imgW, imgH);
    const right = this.eyeAspectRatio(landmarks, RIGHT_EYE, imgW, imgH);
    return (left + right) / 2;
  }

  detectBlinks(earValues: (number | null)[]): { count: number; valid: number[] } {
    const valid = earValues.filter((v): v is number => v !== null);
    if (valid.length < MIN_BLINKS_REQUIRED + 1) return { count: 0, valid };

    const below = valid.map((v) => v < BLINK_EAR_THRESHOLD);
    let blinks = 0;
    let i = 0;
    while (i < below.length) {
      if (below[i]) {
        const start = i;
        while (i < below.length && below[i]) i++;
        const duration = i - start;
        if (duration >= 1 && duration <= 5 && i < below.length) {
          blinks++;
        }
      } else {
        i++;
      }
    }
    return { count: blinks, valid };
  }

  mouthAspectRatio(landmarks: LandmarkPoint[], imgW: number, imgH: number): number {
    const upper = [13, 312].map((i) => ({ x: landmarks[i].x * imgW, y: landmarks[i].y * imgH }));
    const lower = [14, 308].map((i) => ({ x: landmarks[i].x * imgW, y: landmarks[i].y * imgH }));
    const left = { x: landmarks[61].x * imgW, y: landmarks[61].y * imgH };
    const right = { x: landmarks[291].x * imgW, y: landmarks[291].y * imgH };
    const vertical =
      (Math.hypot(upper[0].x - lower[0].x, upper[0].y - lower[0].y) +
        Math.hypot(upper[1].x - lower[1].x, upper[1].y - lower[1].y)) /
      2;
    const horizontal = Math.hypot(left.x - right.x, left.y - right.y);
    if (horizontal === 0) return 0;
    return vertical / horizontal;
  }

  smileRatio(landmarks: LandmarkPoint[], imgW: number, imgH: number): number {
    const leftCorner = { x: landmarks[61].x * imgW, y: landmarks[61].y * imgH };
    const rightCorner = { x: landmarks[291].x * imgW, y: landmarks[291].y * imgH };
    const mouthWidth = Math.hypot(leftCorner.x - rightCorner.x, leftCorner.y - rightCorner.y);
    const leftCheek = { x: landmarks[234].x * imgW, y: landmarks[234].y * imgH };
    const rightCheek = { x: landmarks[454].x * imgW, y: landmarks[454].y * imgH };
    const faceWidth = Math.hypot(leftCheek.x - rightCheek.x, leftCheek.y - rightCheek.y);
    return faceWidth > 0 ? mouthWidth / faceWidth : 0;
  }

  estimateHeadPose(landmarks: LandmarkPoint[]): { yaw: number; pitch: number; roll: number } {
    const nose = landmarks[1];
    const leftEye = landmarks[33];
    const rightEye = landmarks[263];
    const leftMouth = landmarks[61];
    const rightMouth = landmarks[291];

    const roll = Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x) * (180 / Math.PI);
    const eyeMidX = (leftEye.x + rightEye.x) / 2;
    const noseOffset = (nose.x - eyeMidX) / (rightEye.x - leftEye.x + 1e-6);
    const yaw = -noseOffset * 60;
    const eyeMidY = (leftEye.y + rightEye.y) / 2;
    const mouthMidY = (leftMouth.y + rightMouth.y) / 2;
    const faceHeight = mouthMidY - eyeMidY;
    const noseMidY = (nose.y - eyeMidY) / (faceHeight + 1e-6);
    const pitch = (0.5 - noseMidY) * 60;

    return { yaw, pitch, roll };
  }

  assessBlur(imageData: ImageData): number {
    const { width, height, data } = imageData;
    const gray = new Float32Array(width * height);
    for (let i = 0; i < width * height; i++) {
      const idx = i * 4;
      gray[i] = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
    }
    let sumSq = 0;
    let count = 0;
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        const lap =
          4 * gray[idx] - gray[idx - 1] - gray[idx + 1] - gray[idx - width] - gray[idx + width];
        sumSq += lap * lap;
        count++;
      }
    }
    const variance = count > 0 ? sumSq / count : 0;
    return Math.min(1.0, variance / 10000);
  }

  assessColorDiversity(imageData: ImageData): number {
    const { width, height, data } = imageData;
    let sSum = 0, vSum = 0, sSumSq = 0, vSumSq = 0;
    let count = 0;
    for (let i = 0; i < width * height; i++) {
      const idx = i * 4;
      const r = data[idx] / 255;
      const g = data[idx + 1] / 255;
      const b = data[idx + 2] / 255;
      const maxC = Math.max(r, g, b);
      const minC = Math.min(r, g, b);
      const delta = maxC - minC;
      const v = maxC;
      const s = maxC === 0 ? 0 : delta / maxC;
      sSum += s; vSum += v;
      sSumSq += s * s; vSumSq += v * v;
      count++;
    }
    if (count === 0) return 0;
    const sMean = sSum / count;
    const vMean = vSum / count;
    const sStd = Math.sqrt(Math.max(0, sSumSq / count - sMean * sMean));
    const vStd = Math.sqrt(Math.max(0, vSumSq / count - vMean * vMean));
    return Math.min(1.0, sStd + vStd);
  }

  checkFrameDiversity(frames: Uint8ClampedArray[]): { ok: boolean; avgDiff: number } {
    if (frames.length < 2) return { ok: false, avgDiff: 0 };
    const diffs: number[] = [];
    for (let i = 1; i < frames.length; i++) {
      const prev = frames[i - 1];
      const curr = frames[i];
      let sumSq = 0;
      let samples = 0;
      const len = Math.min(prev.length, curr.length);
      for (let j = 0; j < len; j += 16) {
        const diff = curr[j] - prev[j];
        sumSq += diff * diff;
        samples++;
      }
      diffs.push(Math.sqrt(sumSq / Math.max(1, samples)));
    }
    const avgDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    return { ok: avgDiff >= LIVENESS_FRAME_DIVERSITY_THRESHOLD, avgDiff };
  }

  private async fileToCanvas(file: File): Promise<HTMLCanvasElement | null> {
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) { bitmap.close(); return null; }
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      return canvas;
    } catch {
      return null;
    }
  }

  generateChallengeSteps(): ClientChallengeStep[] {
    const numSteps = CHALLENGE_MIN_STEPS + Math.floor(Math.random() * (CHALLENGE_MAX_STEPS - CHALLENGE_MIN_STEPS + 1));
    const shuffled = [...CHALLENGE_ACTION_POOL].sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, numSteps);

    return selected.map((action) => {
      const step: ClientChallengeStep = { action, instruction: "", params: {} };
      switch (action) {
        case "blink": {
          const count = CHALLENGE_MIN_BLINKS + Math.floor(Math.random() * (CHALLENGE_MAX_BLINKS - CHALLENGE_MIN_BLINKS + 1));
          step.params = { count };
          step.instruction = count === 1 ? "Blink once" : `Blink ${count} times`;
          break;
        }
        case "smile":
          step.instruction = "Smile";
          break;
        case "turn_left":
          step.instruction = "Turn head to the left";
          break;
        case "turn_right":
          step.instruction = "Turn head to the right";
          break;
        case "mouth_open":
          step.instruction = "Open your mouth";
          break;
      }
      return step;
    });
  }

  async verifyActionOnFrame(
    video: HTMLVideoElement,
    action: string
  ): Promise<{ detected: boolean; value?: number; threshold?: number; progress?: number; guide?: string }> {
    const landmarks = await this.detectFaces(video);
    if (!landmarks) return { detected: false };
    switch (action) {
      case "smile": {
        const v = this.smileRatio(landmarks, video.videoWidth, video.videoHeight);
        const p = Math.min(1, v / CHALLENGE_SMILE_THRESHOLD);
        const guide = p < 0.5 ? "Smile more" : p < 0.9 ? "Almost there, keep smiling" : "Hold your smile";
        return { detected: v > CHALLENGE_SMILE_THRESHOLD, value: v, threshold: CHALLENGE_SMILE_THRESHOLD, progress: p, guide };
      }
      case "turn_left": {
        const pose = this.estimateHeadPose(landmarks);
        const p = Math.min(1, -pose.yaw / CHALLENGE_HEAD_TURN_YAW_THRESHOLD);
        const guide = p < 0.5 ? "Turn your head to the left" : p < 0.9 ? "Almost there, keep turning left" : "Hold your head still";
        return { detected: pose.yaw < -CHALLENGE_HEAD_TURN_YAW_THRESHOLD, value: pose.yaw, threshold: -CHALLENGE_HEAD_TURN_YAW_THRESHOLD, progress: p, guide };
      }
      case "turn_right": {
        const pose = this.estimateHeadPose(landmarks);
        const p = Math.min(1, pose.yaw / CHALLENGE_HEAD_TURN_YAW_THRESHOLD);
        const guide = p < 0.5 ? "Turn your head to the right" : p < 0.9 ? "Almost there, keep turning right" : "Hold your head still";
        return { detected: pose.yaw > CHALLENGE_HEAD_TURN_YAW_THRESHOLD, value: pose.yaw, threshold: CHALLENGE_HEAD_TURN_YAW_THRESHOLD, progress: p, guide };
      }
      case "mouth_open": {
        const v = this.mouthAspectRatio(landmarks, video.videoWidth, video.videoHeight);
        const p = Math.min(1, v / CHALLENGE_MOUTH_OPEN_MAR_THRESHOLD);
        const guide = p < 0.5 ? "Open your mouth wider" : p < 0.9 ? "Almost there, a bit more" : "Hold your mouth open";
        return { detected: v > CHALLENGE_MOUTH_OPEN_MAR_THRESHOLD, value: v, threshold: CHALLENGE_MOUTH_OPEN_MAR_THRESHOLD, progress: p, guide };
      }
      default:
        return { detected: false };
    }
  }

  async computeEarFromVideo(video: HTMLVideoElement): Promise<number | null> {
    const landmarks = await this.detectFaces(video);
    if (!landmarks) return null;
    return this.computeEarForFrame(landmarks, video.videoWidth, video.videoHeight);
  }

  async verifyChallengeStep(action: string, params: Record<string, unknown>, files: File[]): Promise<boolean> {
    if (!this.modelLoaded || !this.faceLandmarker || files.length < 3) return false;

    const canvases = (await Promise.all(files.map((f) => this.fileToCanvas(f)))).filter(
      (c): c is HTMLCanvasElement => c !== null
    );
    if (canvases.length < 3) return false;

    if (action === "blink") {
      const expected = (params.count as number) || 1;
      const earValues: (number | null)[] = [];
      for (const canvas of canvases) {
        const landmarks = await this.detectFaces(canvas);
        if (landmarks) {
          earValues.push(this.computeEarForFrame(landmarks, canvas.width, canvas.height));
        } else {
          earValues.push(null);
        }
      }
      const { count } = this.detectBlinks(earValues);
      return count >= expected;
    }

    for (const canvas of canvases) {
      const landmarks = await this.detectFaces(canvas);
      if (!landmarks) continue;

      switch (action) {
        case "smile": {
          const sr = this.smileRatio(landmarks, canvas.width, canvas.height);
          if (sr > CHALLENGE_SMILE_THRESHOLD) return true;
          break;
        }
        case "turn_left": {
          const p = this.estimateHeadPose(landmarks);
          if (p.yaw < -CHALLENGE_HEAD_TURN_YAW_THRESHOLD) return true;
          break;
        }
        case "turn_right": {
          const p = this.estimateHeadPose(landmarks);
          if (p.yaw > CHALLENGE_HEAD_TURN_YAW_THRESHOLD) return true;
          break;
        }
        case "mouth_open": {
          const mar = this.mouthAspectRatio(landmarks, canvas.width, canvas.height);
          if (mar > CHALLENGE_MOUTH_OPEN_MAR_THRESHOLD) return true;
          break;
        }
      }
    }
    return false;
  }

  async fullAssessment(files: File[]): Promise<ClientLivenessResult> {
    if (!this.modelLoaded || !this.faceLandmarker) {
      return {
        passed: false, passive_score: 0, blur_score: 0, color_score: 0,
        blink_detected: false, blinks_count: 0,
        frame_diversity_ok: false, frame_diversity: 0,
        method: "client", face_detected: false,
        message: "FaceLandmarker model not loaded",
      };
    }

    if (files.length < 2) {
      return {
        passed: false, passive_score: 0, blur_score: 0, color_score: 0,
        blink_detected: false, blinks_count: 0,
        frame_diversity_ok: false, frame_diversity: 0,
        method: "client", face_detected: false,
        message: "Need at least 2 frames",
      };
    }

    const canvases = (await Promise.all(files.map((f) => this.fileToCanvas(f)))).filter(
      (c): c is HTMLCanvasElement => c !== null
    );

    if (canvases.length < 2) {
      return {
        passed: false, passive_score: 0, blur_score: 0, color_score: 0,
        blink_detected: false, blinks_count: 0,
        frame_diversity_ok: false, frame_diversity: 0,
        method: "client", face_detected: false,
        message: "Failed to decode frames",
      };
    }

    const earValues: (number | null)[] = [];
    const faceDetected: boolean[] = [];
    const rawFrames: Uint8ClampedArray[] = [];

    for (const canvas of canvases) {
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        earValues.push(null);
        faceDetected.push(false);
        rawFrames.push(new Uint8ClampedArray());
        continue;
      }
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      rawFrames.push(new Uint8ClampedArray(imageData.data));

      const landmarks = await this.detectFaces(canvas);
      if (landmarks) {
        faceDetected.push(true);
        earValues.push(this.computeEarForFrame(landmarks, canvas.width, canvas.height));
      } else {
        faceDetected.push(false);
        earValues.push(null);
      }
    }

    const anyFaceDetected = faceDetected.some((d) => d);
    const faceRatio = faceDetected.filter((d) => d).length / faceDetected.length;

    const { count: blinkCount } = this.detectBlinks(earValues);
    const blinkDetected = blinkCount >= MIN_BLINKS_REQUIRED;

    // Find first frame with a face for quality metrics
    let blurScore = 0;
    let colorScore = 0;
    for (let i = 0; i < canvases.length; i++) {
      if (faceDetected[i]) {
        const ctx = canvases[i].getContext("2d");
        if (ctx) {
          const id = ctx.getImageData(0, 0, canvases[i].width, canvases[i].height);
          blurScore = this.assessBlur(id);
          colorScore = this.assessColorDiversity(id);
        }
        break;
      }
    }

    const passiveScore = 0.5 * blurScore + 0.5 * colorScore;
    const { ok: diversityOk, avgDiff: diversity } = this.checkFrameDiversity(rawFrames);
    const passed = faceRatio >= 0.5 && blinkDetected && diversityOk && passiveScore >= LIVENESS_PASSIVE_THRESHOLD;

    const failures: string[] = [];
    if (faceRatio < 0.5) failures.push("face_not_detected");
    if (!blinkDetected) failures.push("blink");
    if (!diversityOk) failures.push("diversity");
    if (passiveScore < LIVENESS_PASSIVE_THRESHOLD) failures.push("passive");

    return {
      passed,
      passive_score: passiveScore,
      blur_score: blurScore,
      color_score: colorScore,
      blink_detected: blinkDetected,
      blinks_count: blinkCount,
      frame_diversity_ok: diversityOk,
      frame_diversity: diversity,
      method: "client",
      face_detected: anyFaceDetected,
      message: passed ? "" : `Client liveness failed: ${failures.join(", ")}`,
    };
  }
}
