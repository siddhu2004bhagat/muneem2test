/**
 * Platform Detection Utility
 * Detects if running on Linux tablet (Raspberry Pi) and adjusts behavior accordingly
 */

/**
 * Detect if running on Linux/ARM platform (Raspberry Pi or Linux touchscreen device)
 * Pi 5 has 4 cores. Chromium on Bookworm may not include 'arm' in UA.
 * Most reliable signal: Linux + touch input capability.
 */
export function isLinuxTablet(): boolean {
  if (typeof window === 'undefined') return false;

  const userAgent = navigator.userAgent.toLowerCase();
  const platform = navigator.platform.toLowerCase();

  // Must be Linux (not macOS, not Windows)
  const isLinux =
    (platform.includes('linux') || userAgent.includes('linux')) &&
    !platform.includes('mac') &&
    !userAgent.includes('mac') &&
    !userAgent.includes('windows');

  if (!isLinux) return false;

  // On Linux, check for touch capability — Pi with touchscreen is a "Linux tablet"
  const hasTouchScreen =
    navigator.maxTouchPoints > 0 ||
    'ontouchstart' in window;

  // Check for ARM or low core count (Pi 4 = 4 cores, Pi 5 = 4 cores)
  const isARM =
    userAgent.includes('arm') ||
    userAgent.includes('aarch') ||
    navigator.hardwareConcurrency <= 4;

  // Check for low memory (Pi 4/5 typically report 4GB or less)
  const hasLowMemory = (navigator as any).deviceMemory
    ? (navigator as any).deviceMemory <= 4
    : true; // Assume constrained if deviceMemory API not available

  // Linux + touch + (ARM or low memory) = Raspberry Pi / Linux tablet
  return hasTouchScreen && (isARM || hasLowMemory);
}

/**
 * Detect if device has limited memory (< 4GB)
 */
export function hasLimitedMemory(): boolean {
  if (typeof window === 'undefined') return true;

  // Use Device Memory API if available
  if ((navigator as any).deviceMemory) {
    return (navigator as any).deviceMemory <= 4;
  }

  // Fallback: Check hardware concurrency (Pi 4 has 4 cores)
  return navigator.hardwareConcurrency <= 4;
}

/**
 * Get recommended OCR mode based on platform
 * Returns 'backend' for Linux tablets, 'hybrid' for others
 */
export function getRecommendedOCRMode(): 'backend' | 'hybrid' {
  if (isLinuxTablet()) {
    return 'backend'; // Always use backend OCR on Linux tablets
  }
  return 'hybrid'; // Use hybrid (Tesseract.js + backend) on other platforms
}

/**
 * Check if TensorFlow.js should be disabled
 */
export function shouldDisableTensorFlow(): boolean {
  return isLinuxTablet() || hasLimitedMemory();
}

