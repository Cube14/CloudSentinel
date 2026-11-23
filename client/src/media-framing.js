export const reelAspect = 16 / 9;

// Fractions match CSS object-position, measured from the left and top of the frame.
export const framing = {
  overview: [.50, .50],
  environments: [.50, .44],
  findings: [.52, .48],
  assets: [.57, .51],
  identity: [.52, .50],
  threats: [.50, .49],
  analyst: [.50, .48],
  audit: [.55, .49],
};

export function coverWindow(sourceAspect, apertureAspect, [x, y]) {
  const width = Math.min(1, apertureAspect / sourceAspect);
  const height = Math.min(1, sourceAspect / apertureAspect);
  return [width, height, (1 - width) * x, (1 - height) * (1 - y)];
}
