import { FilesetResolver, HandLandmarker, PoseLandmarker } from '@mediapipe/tasks-vision'

export interface VisionFileset {
  wasmLoaderPath: string
  wasmBinaryPath: string
}

let visionPromise: ReturnType<typeof FilesetResolver.forVisionTasks> | null = null

function getVision() {
  visionPromise ??= FilesetResolver.forVisionTasks(import.meta.env.BASE_URL + 'wasm').catch((error) => {
    visionPromise = null
    throw error
  })
  return visionPromise
}

export type PoseModel = 'lite' | 'full'
const modelDetails = new WeakMap<PoseLandmarker, { model: PoseModel; delegate: string; numPoses: number }>()
export const poseModelDetails = (landmarker: PoseLandmarker) => modelDetails.get(landmarker)

export async function createPoseLandmarker(
  numPoses: number,
  model: PoseModel = 'lite',
  workerFileset?: VisionFileset,
): Promise<PoseLandmarker> {
  const vision = workerFileset ?? await getVision()
  const options = {
    baseOptions: {
      modelAssetPath: import.meta.env.BASE_URL + `models/pose_landmarker_${model}.task`,
      delegate: 'GPU' as const,
    },
    runningMode: 'VIDEO' as const,
    numPoses,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  }
  try {
    const landmarker = await PoseLandmarker.createFromOptions(vision, options)
    modelDetails.set(landmarker, { model, delegate: 'GPU', numPoses })
    return landmarker
  } catch {
    // Some browsers/GPUs fail on the GPU delegate; CPU is slower but always works.
    const landmarker = await PoseLandmarker.createFromOptions(vision, {
      ...options,
      baseOptions: { ...options.baseOptions, delegate: 'CPU' },
    })
    modelDetails.set(landmarker, { model, delegate: 'CPU', numPoses })
    return landmarker
  }
}

export async function createHandLandmarker(numHands: number): Promise<HandLandmarker> {
  const vision = await getVision()
  const options = {
    baseOptions: {
      modelAssetPath: import.meta.env.BASE_URL + 'models/hand_landmarker.task',
      delegate: 'GPU' as const,
    },
    runningMode: 'VIDEO' as const,
    numHands,
    // Hands in a wide dance shot are small; the defaults miss most of them.
    minHandDetectionConfidence: 0.3,
    minHandPresenceConfidence: 0.3,
    minTrackingConfidence: 0.3,
  }
  try {
    return await HandLandmarker.createFromOptions(vision, options)
  } catch {
    return await HandLandmarker.createFromOptions(vision, {
      ...options,
      baseOptions: { ...options.baseOptions, delegate: 'CPU' },
    })
  }
}
