/** Stable package identity for diagnostics and boundary tests. */
export const FRAME_SCHEDULER_PACKAGE_NAME = '@kyxos/render-frame-scheduler' as const;

export type {
  DirtyFlag,
  FrameSchedulerController,
  FrameSchedulerDiagnostics,
  FrameRequestDriver,
  FrameRequestId,
  FrameSchedulerEvents,
  FrameSchedulerHistoryResetEvent,
  FrameSchedulerModeChangeEvent,
  FrameSchedulerOptions,
  FrameSchedulingStrategy,
  RenderMode,
  ScheduledFrame,
  TemporalFrameMetadata,
  TemporalScheduledFrame,
} from './scheduler.js';
export { DIRTY_FLAGS, FrameScheduler, isDirtyFlag } from './scheduler.js';
export {
  DEFAULT_TEMPORAL_HISTORY_RESET_FLAGS,
  FRAME_ACTIVITIES,
  TemporalFrameScheduler,
  type FrameActivity,
  type TemporalFrameSchedulerOptions,
  type TemporalFrameSchedulerState,
} from './temporal-scheduler.js';
