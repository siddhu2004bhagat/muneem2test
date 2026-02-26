import { useCallback, useRef, useEffect } from 'react';
import type { StrokePoint } from '../types/pen.types';
import { usePalmRejection, type PalmRejectionConfig } from './usePalmRejection';

interface Handlers {
  onPointerDown: (e: React.PointerEvent<HTMLCanvasElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLCanvasElement>) => void;
  onPointerUp: (e: React.PointerEvent<HTMLCanvasElement>) => void;
}

export interface PointerEventsConfig {
  /** Custom palm rejection configuration */
  palmRejection?: Partial<PalmRejectionConfig>;

  /** Enable enhanced palm rejection (default: true) */
  enablePalmRejection?: boolean;

  /** Enable debug logging for palm rejection */
  debugPalmRejection?: boolean;
}

export function usePointerEvents(
  opts: {
    getPosition: (e: React.PointerEvent) => { x: number; y: number; pressure: number };
    beginStroke: (p: StrokePoint) => void;
    extendStroke: (p: StrokePoint) => void;
    endStroke: () => void;
  },
  config?: PointerEventsConfig
): Handlers {
  const enablePalmRejection = config?.enablePalmRejection !== false;
  const debugMode = config?.debugPalmRejection || false;

  // Legacy refs for backward compatibility
  const activePenRef = useRef<boolean>(false);
  const activePointerIdRef = useRef<number | null>(null);
  const activePointersRef = useRef<Set<number>>(new Set());

  // Enhanced palm rejection
  const palmRejection = usePalmRejection(config?.palmRejection);

  // Track delayed strokes that are waiting for temporal delay
  const delayedStrokesRef = useRef<Map<number, { x: number; y: number; pressure: number }>>(new Map());

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      palmRejection.cancelAllPending();
    };
  }, [palmRejection]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    // Two-finger scrolling detection: if there's already an active pointer, ignore this one
    if (activePointersRef.current.size > 0 && activePointerIdRef.current !== e.pointerId) {
      activePointersRef.current.add(e.pointerId);
      if (debugMode) {
        console.log('[PalmRejection] Multi-touch detected, ignoring pointer', e.pointerId);
      }
      return; // Let browser handle scrolling
    }

    // Enhanced palm rejection (if enabled)
    if (enablePalmRejection && e.pointerType === 'touch') {
      const canvasHeight = (e.target as HTMLCanvasElement).height;

      // Tier 1: Immediate rejection
      const immediateCheck = palmRejection.checkImmediateRejection(e, canvasHeight);
      if (immediateCheck.shouldReject) {
        if (debugMode) {
          console.log('[PalmRejection] Immediate rejection:', immediateCheck.reason);
        }
        return;
      }

      // Register pointer for tracking
      palmRejection.registerPointerDown(e, canvasHeight);

      // Tier 2: Temporal delay (queue and wait)
      const position = opts.getPosition(e);

      palmRejection.queuePointerForDelay(
        e,
        // onAccept callback
        (acceptedEvent) => {
          if (debugMode) {
            console.log('[PalmRejection] Pointer accepted after delay:', acceptedEvent.pointerId);
          }

          // Track this pointer
          activePointerIdRef.current = acceptedEvent.pointerId;
          activePointersRef.current.add(acceptedEvent.pointerId);

          // Capture pointer for drawing
          (acceptedEvent.target as Element).setPointerCapture(acceptedEvent.pointerId);

          // Get the stored position (or recalculate if needed)
          const storedPosition = delayedStrokesRef.current.get(acceptedEvent.pointerId);
          const finalPosition = storedPosition || opts.getPosition(acceptedEvent);
          delayedStrokesRef.current.delete(acceptedEvent.pointerId);

          // Begin stroke
          opts.beginStroke({
            x: finalPosition.x,
            y: finalPosition.y,
            pressure: Math.max(0.1, finalPosition.pressure || 1),
            timestamp: performance.now()
          });
        },
        // onReject callback
        (rejectedPointerId, reason) => {
          if (debugMode) {
            console.log('[PalmRejection] Pointer rejected:', rejectedPointerId, reason);
          }
          delayedStrokesRef.current.delete(rejectedPointerId);
          palmRejection.unregisterPointer(rejectedPointerId);
        }
      );

      // Store position for delayed processing
      delayedStrokesRef.current.set(e.pointerId, position);
      return;
    }

    // Legacy palm rejection - only when palm rejection is ENABLED (skip when disabled for Pi/tablet)
    // When disabled, accept all touches (finger input on Pi touchscreen)
    if (e.pointerType === 'touch' && enablePalmRejection) {
      if (activePenRef.current) return;
      if ((e.width && e.width > 30) || (e.height && e.height > 30)) return;
    }

    // Prefer pen
    if (e.pointerType === 'pen') activePenRef.current = true;

    // Track this pointer
    activePointerIdRef.current = e.pointerId;
    activePointersRef.current.add(e.pointerId);

    // Capture pointer for drawing
    (e.target as Element).setPointerCapture(e.pointerId);

    const { x, y, pressure } = opts.getPosition(e);
    opts.beginStroke({
      x,
      y,
      pressure: Math.max(0.1, pressure || 1),
      timestamp: performance.now()
    });
  }, [opts, enablePalmRejection, debugMode, palmRejection]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (activePointerIdRef.current !== e.pointerId) return;

    const { x, y, pressure } = opts.getPosition(e);

    // Tier 3: Velocity analysis (if enabled)
    if (enablePalmRejection && e.pointerType === 'touch') {
      const velocityCheck = palmRejection.trackPointerMovement(e.pointerId, e.clientX, e.clientY);
      if (velocityCheck.shouldReject) {
        if (debugMode) {
          console.log('[PalmRejection] Velocity rejection:', velocityCheck.reason);
        }

        // Cancel this stroke
        opts.endStroke();
        activePointerIdRef.current = null;
        activePointersRef.current.delete(e.pointerId);
        palmRejection.unregisterPointer(e.pointerId);

        // Fire pointercancel to clean up
        (e.target as Element).releasePointerCapture(e.pointerId);
        return;
      }
    }

    opts.extendStroke({
      x,
      y,
      pressure: Math.max(0.1, pressure || 1),
      timestamp: performance.now()
    });
  }, [opts, enablePalmRejection, debugMode, palmRejection]);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    // Remove from active pointers set
    activePointersRef.current.delete(e.pointerId);

    // Clean up delayed stroke data
    delayedStrokesRef.current.delete(e.pointerId);

    // Unregister from palm rejection
    if (enablePalmRejection) {
      palmRejection.unregisterPointer(e.pointerId);
    }

    // Only end stroke if this was the primary drawing pointer
    if (activePointerIdRef.current === e.pointerId) {
      (e.target as Element).releasePointerCapture(e.pointerId);
      opts.endStroke();
      activePointerIdRef.current = null;
      if (e.pointerType === 'pen') activePenRef.current = false;
    }

    // If no more active pointers, reset state
    if (activePointersRef.current.size === 0) {
      activePointerIdRef.current = null;
      activePenRef.current = false;
    }
  }, [opts, enablePalmRejection, palmRejection]);

  return { onPointerDown, onPointerMove, onPointerUp };
}

export default usePointerEvents;


