/** Stable package identity for diagnostics and boundary tests. */
export const FRAME_SCHEDULER_PACKAGE_NAME = '@kyxos/render-frame-scheduler' as const;

export type {
  DirtyFlag,
  FrameRequestDriver,
  FrameRequestId,
  FrameSchedulerEvents,
  FrameSchedulerOptions,
  RenderMode,
  ScheduledFrame,
} from './scheduler.js';
export { DIRTY_FLAGS, FrameScheduler, isDirtyFlag } from './scheduler.js';
