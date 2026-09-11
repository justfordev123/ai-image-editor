// Headless TUI lets Angular own the responsive controls (the built-in UI has a 550px minimum).
// These TUI options style the canvas controls; styles.scss owns the matching Material theme.
export const CREAITION_THEME = {
  selectionStyle: {
    cornerColor: '#ffffff',
    cornerStrokeColor: '#000000',
    borderColor: '#000000',
    cornerSize: 10,
    transparentCorners: false,
    rotatingPointOffset: 24,
  },
  usageStatistics: false,
};
