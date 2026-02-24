/**
 * Platform Detection Utility
 * Detects if running on Linux tablet (Raspberry Pi) and adjusts behavior accordingly
 */

/**
 * Detect if running on Linux/ARM platform (Raspberry Pi)
 */
export function isLinuxTablet(): boolean {
  if (typeof window === 'undefined') return false;

  const userAgent = navigator.userAgent.toLowerCase();
  const platform = navigator.platform.toLowerCase();

  // Check for Linux precisely, excluding Mac
  const isLinux = (platform.includes('linux') || userAgent.includes('linux')) && !platform.includes('mac') && !userAgent.includes('mac');

  // Check for ARM architecture (common on Pi)
  const isARM = userAgent.includes('arm') ||
    navigator.hardwareConcurrency <= 4; // Pi 4 has 4 cores

  // Check for low memory (Pi 4 typically has 4GB)
  const hasLowMemory = (navigator as any).deviceMemory
    ? (navigator as any).deviceMemory <= 4
    : true; // Assume low memory if deviceMemory API not available

  return isLinux && (isARM || hasLowMemory);
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

