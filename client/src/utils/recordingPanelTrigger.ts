// Shared imperative handle so any component can open the header's recording
// popover (DesktopRecordingControls). DesktopRecordingControls registers its
// open setter on mount; the mobile CC prompt's More popover calls open() so the
// Record button there surfaces the same UI as the header button instead of
// stacking its own recordings panel above the input.
export const recordingPanelTrigger = {
  open: null as (() => void) | null,
};
