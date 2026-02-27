import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Pen, Check, X, RotateCcw, Download, Upload, Zap } from 'lucide-react';
import useCanvas from './hooks/useCanvas';
import usePointerEvents from './hooks/usePointerEvents';
import { EnhancedRecognitionService } from './services/recognition.service';
import type { OCRResult } from './services/ocrHybrid.service';
import { getCorrectionService } from './services/correction.service';

// Lazy-load OCR service to reduce main bundle
const loadOCR = async () => {
  const mod = await import(/* webpackChunkName: "ocr-hybrid" */ './services/ocrHybrid.service');
  return mod;
};

const loadRecognition = async () => {
  const mod = await import(/* webpackChunkName: "ocr-recognition" */ './services/recognition.service');
  return mod;
};
import type { OCRCorrection } from '@/lib/localStore';
import ToolPalette from './components/ToolPalette';
import LassoOverlay from './components/LassoOverlay';
import TextCorrectionOverlay from './components/TextCorrectionOverlay';
import OCRResultsToast from './components/OCRResultsToast';
import OCRConfirm from './ocr/components/OCRConfirm';
import { postProcessOCRResult } from './ocr/postprocess';
import { toast } from 'sonner';
import ShapeSnapOverlay from './components/ShapeSnapOverlay';
import { detectShape } from './services/shapeSnapper';
import { usePenTool, PenToolProvider } from './context/PenToolContext';
import { useNotebook } from './context/NotebookContext';
import NotebookNav from './components/NotebookNav';
import type { PenCanvasProps } from './types';
import { drawTemplate } from './templates';
// isLinuxTablet import removed — palm rejection is now disabled unconditionally

interface RecognitionResult {
  text: string;
  confidence: number;
  structuredData: {
    amounts: string[];
    dates: string[];
    phones: string[];
    emails: string[];
    gstNumbers: string[];
  };
}

function PenCanvasInner({ onRecognized, onClose }: PenCanvasProps) {
  const {
    canvasRef,
    backgroundCanvasRef,
    containerRef,
    config,
    setConfig,
    beginStroke,
    extendStroke,
    endStroke,
    clearCanvas,
    undo,
    redo,
    getContentBoundingBox, // NEW: For OCR optimization
  } = useCanvas();

  const { mode, tool, color, width, opacity } = usePenTool();

  // NEW: Notebook context for multi-page support
  const {
    currentPage,
    updateCurrentPage,
    savePage
  } = useNotebook();
  const [pendingShape, setPendingShape] = useState<unknown>(null);
  const [recognitionResults, setRecognitionResults] = useState<RecognitionResult[]>([]);
  const [recognizing, setRecognizing] = useState(false);
  const [selectedResult, setSelectedResult] = useState<RecognitionResult | null>(null);
  const [showStructuredData, setShowStructuredData] = useState(false);

  // NEW: State for hybrid OCR
  const [ocrResults, setOcrResults] = useState<OCRResult[]>([]);
  const [showOCRToast, setShowOCRToast] = useState(false);
  const [showCorrectionOverlay, setShowCorrectionOverlay] = useState(false);

  // NEW: State for OCR confirm dialog
  const [showOCRConfirm, setShowOCRConfirm] = useState(false);
  const [currentOCRData, setCurrentOCRData] = useState<{
    text: string;
    confidence: number;
    imageHash: string;
    processedFields?: Record<string, unknown>;
  } | null>(null);

  // Helper function to generate image hash for telemetry
  const generateImageHash = async (imageData: ImageData): Promise<string> => {
    const buffer = await crypto.subtle.digest('SHA-256', imageData.data);
    const hashArray = Array.from(new Uint8Array(buffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  };

  // Helper function to create OCR summary from results
  const createOCRSummary = useCallback((results: OCRResult[]) => {
    if (results.length === 0) {
      return {
        count: 0,
        averageConfidence: 0,
        hasLowConfidence: false
      };
    }

    const totalConfidence = results.reduce((sum, r) => sum + r.confidence, 0);
    const averageConfidence = totalConfidence / results.length;
    const hasLowConfidence = results.some(r => r.confidence < 0.6);

    return {
      count: results.length,
      averageConfidence,
      hasLowConfidence
    };
  }, []);

  // Draw template on background canvas when page/template changes
  useEffect(() => {
    const bgCanvas = backgroundCanvasRef.current;
    if (!bgCanvas || !currentPage) return;

    const ctx = bgCanvas.getContext('2d');
    if (!ctx) return;

    // Clear background
    ctx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);

    // Draw template
    const templateId = currentPage.templateId || 'lined';
    const width = bgCanvas.width;
    const height = bgCanvas.height;

    try {
      drawTemplate(ctx, width, height, templateId, {
        lineSpacing: 30,
        margin: 40,
        columnCount: 4,
        color: '#e0e0e0',
      });
    } catch (error) {
      console.error('[PenCanvas] Error drawing template:', error);
    }
  }, [currentPage, backgroundCanvasRef]);

  const getPosition = (e: React.PointerEvent) => {
    const canvas = canvasRef.current!;
    if (!canvas) return { x: 0, y: 0, pressure: 1 };

    const rect = canvas.getBoundingClientRect();
    const container = containerRef.current;
    const dpr = window.devicePixelRatio || 1;

    // CRITICAL FIX FOR IPAD: Properly calculate coordinates accounting for CSS transform
    // Canvas has CSS transform: scale(zoom) translate(pan.x, pan.y)
    // CSS transforms apply right-to-left: scale(zoom) THEN translate(pan.x, pan.y)
    // So: canvas coord (x,y) → screen: (x * zoom) + pan.x, (y * zoom) + pan.y
    // Inverse: screen coord → canvas: (screenX - pan.x) / zoom, (screenY - pan.y) / zoom

    // Get coordinates relative to the canvas element's bounding box (in viewport pixels)
    // getBoundingClientRect() returns the transformed bounding box
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    // Account for container scroll (canvas is absolutely positioned, container scrolls)
    // scrollTop is in CSS pixels, same coordinate space as canvas
    const scrollY = container ? container.scrollTop : 0;

    // Inverse the CSS transform to get canvas coordinates (in CSS pixels)
    // CSS transform: scale(zoom) translate(pan.x, pan.y)
    // Transform order: scale first, then translate
    // So: canvas (x,y) → screen: (x * zoom + pan.x, y * zoom + pan.y)
    // Inverse: screen → canvas: ((screenX - pan.x) / zoom, (screenY - pan.y) / zoom)
    // Canvas context is scaled by DPR internally, so we work in CSS pixels
    const x = (screenX - config.pan.x) / config.zoom;
    const y = ((screenY + scrollY) - config.pan.y) / config.zoom;

    // Get pressure - for touch devices, use width/height as pressure indicator
    let pressure = (e as React.PointerEvent & { pressure?: number }).pressure ?? 1;

    // For touch devices without pressure support, simulate based on touch area
    if (e.pointerType === 'touch' && pressure === 1) {
      // Use touch width/height to estimate pressure (larger touch = more pressure)
      const touchWidth = (e as any).width || 0;
      const touchHeight = (e as any).height || 0;
      const touchArea = Math.max(touchWidth, touchHeight);
      if (touchArea > 0) {
        // Normalize touch area to pressure (0.5 to 1.0 range)
        pressure = Math.min(1.0, Math.max(0.5, 0.5 + (touchArea / 60) * 0.5));
      }
    }

    return { x, y, pressure: Math.max(0.1, Math.min(1.0, pressure)) };
  };

  const { onPointerDown, onPointerMove, onPointerUp } = usePointerEvents(
    {
      getPosition,
      beginStroke,
      extendStroke,
      endStroke,
    },
    { enablePalmRejection: false } // Disabled: palm rejection only blocks touch/finger input. Pen/stylus input bypasses this anyway.
  );

  // ── Native DOM listener fallback for Pi Chromium ──────────────────────────
  // React's synthetic event system can miss pointer events on Pi/Linux Chromium.
  // We register native (non-React) listeners directly on the canvas DOM node.
  // These fire in the capture phase, guaranteeing delivery before any scroll logic.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleDown = (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      canvas.setPointerCapture(e.pointerId);
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) / config.zoom;
      const y = (e.clientY - rect.top) / config.zoom;
      const pressure = e.pressure > 0 ? e.pressure : 1;
      beginStroke({ x, y, pressure, timestamp: performance.now() });
    };
    const handleMove = (e: PointerEvent) => {
      if (!canvas.hasPointerCapture(e.pointerId)) return;
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) / config.zoom;
      const y = (e.clientY - rect.top) / config.zoom;
      const pressure = e.pressure > 0 ? e.pressure : 1;
      extendStroke({ x, y, pressure, timestamp: performance.now() });
    };
    const handleUp = (e: PointerEvent) => {
      if (canvas.hasPointerCapture(e.pointerId)) {
        canvas.releasePointerCapture(e.pointerId);
      }
      endStroke();
    };

    canvas.addEventListener('pointerdown', handleDown, { capture: true, passive: false });
    canvas.addEventListener('pointermove', handleMove, { capture: true, passive: false });
    canvas.addEventListener('pointerup', handleUp, { capture: true });
    canvas.addEventListener('pointercancel', handleUp, { capture: true });

    return () => {
      canvas.removeEventListener('pointerdown', handleDown, { capture: true });
      canvas.removeEventListener('pointermove', handleMove, { capture: true });
      canvas.removeEventListener('pointerup', handleUp, { capture: true });
      canvas.removeEventListener('pointercancel', handleUp, { capture: true });
    };
  }, [canvasRef, beginStroke, extendStroke, endStroke, config.zoom]);
  // ─────────────────────────────────────────────────────────────────────────


  // Enhanced pointer up handler
  const onUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    onPointerUp(e);

    if (mode === 'shape') {
      // Shape detection logic
      const canvas = canvasRef.current;
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // Simple shape detection based on recent strokes
        const shape = detectShape([{ x, y, pressure: 1, timestamp: Date.now() }]);
        if (shape) {
          setPendingShape(shape);
        }
      }
    } else if (mode === 'ocr') {
      // Enhanced OCR recognition
      performOCR(e);
    }
  };

  const performOCR = async (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, e.clientX - rect.left - 50);
    const y = Math.max(0, e.clientY - rect.top - 25);
    const width = Math.min(canvas.width - x, 100);
    const height = Math.min(canvas.height - y, 50);

    try {
      setRecognizing(true);
      const imageData = ctx.getImageData(x, y, width, height);
      // Lazy-load recognition service
      const { recognizeImageData } = await loadRecognition();
      const result = await recognizeImageData(imageData);

      // Generate image hash for telemetry
      const imageHash = await generateImageHash(imageData);

      // Apply post-processing pipeline BEFORE showing confirm dialog
      const processedResult = postProcessOCRResult(
        result.text,
        result.confidence,
        navigator.language || 'en-IN'
      );

      // Show OCR confirm dialog with processed suggestions
      setCurrentOCRData({
        text: result.text,
        confidence: result.confidence,
        imageHash,
        processedFields: processedResult
      });
      setShowOCRConfirm(true);

    } catch (error) {
      toast.error("OCR recognition failed");
      console.error('OCR Error:', error);
    } finally {
      setRecognizing(false);
    }
  };

  const handleUseResult = (result: RecognitionResult) => {
    onRecognized(result.text);
    setSelectedResult(result);
    setShowStructuredData(true);
  };

  const handleRecognizeAll = useCallback(async () => {
    if (!canvasRef.current) return;

    setRecognizing(true);
    try {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Get full canvas image
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      // Lazy-load recognition service
      const { recognizeImageData } = await loadRecognition();
      const result = await recognizeImageData(imageData);

      const structuredData = EnhancedRecognitionService.extractStructuredData(result.text);

      const recognitionResult: RecognitionResult = {
        text: result.text,
        confidence: result.confidence,
        structuredData
      };

      setRecognitionResults([recognitionResult]);
      setSelectedResult(recognitionResult);

      toast.success("Full canvas recognized!", {
        description: `"${result.text}" (${(result.confidence * 100).toFixed(1)}%)`,
        action: {
          label: "Use",
          onClick: () => handleUseResult(recognitionResult)
        }
      });
    } catch (error) {
      toast.error("Recognition failed");
      console.error('Recognition Error:', error);
    } finally {
      setRecognizing(false);
    }
  }, []);

  // NEW: Hybrid OCR Recognition Handler with Smart Cropping
  const handleHybridRecognize = useCallback(async () => {
    if (!canvasRef.current) return;

    setRecognizing(true);
    setOcrResults([]);
    setShowOCRToast(false);
    setShowCorrectionOverlay(false);

    try {
      const canvas = canvasRef.current;

      // NEW: Get bounding box of drawn content for smart cropping
      const boundingBox = getContentBoundingBox();

      if (!boundingBox) {
        toast.info("No content to recognize", {
          description: "Draw some text on the canvas first"
        });
        setRecognizing(false);
        return;
      }

      console.log(`[PenCanvas] OCR with smart cropping: ${boundingBox.width}x${boundingBox.height}px (${Math.round((boundingBox.width * boundingBox.height) / 1000000 * 10) / 10}M pixels)`);

      // Lazy-load OCR service
      const { getOCRHybridService } = await loadOCR();
      const hybridService = getOCRHybridService();
      const correctionService = getCorrectionService();

      // Initialize correction service
      await correctionService.initialize();

      // Use hybrid OCR service with smart cropping
      let results = await hybridService.recognizeCanvas(canvas, {
        mode: 'auto',
        boundingBox // NEW: Pass bounding box for cropping
      });

      if (results.length === 0) {
        toast.info("No text detected", {
          description: "Try writing more clearly or adjusting the canvas."
        });
        return;
      }

      // PHASE C: Apply adaptive biasing
      const stats = correctionService.getStats();
      if (stats.totalCorrections > 0) {
        console.log(`[PenCanvas] Applying adaptive bias (${stats.totalCorrections} corrections)`);
        results = await correctionService.applyAdaptiveBias(results);
      }

      setOcrResults(results);
      setShowOCRToast(true);

      // Auto-open correction overlay based on user preference
      const shouldShowOverlay = localStorage.getItem('muneem_show_corrections_overlay');
      if (shouldShowOverlay === 'true' || shouldShowOverlay === null) {
        setShowCorrectionOverlay(true);
      }

    } catch (error) {
      toast.error("Hybrid OCR failed", {
        description: error instanceof Error ? error.message : "Unknown error"
      });
      console.error('Hybrid OCR Error:', error);
    } finally {
      setRecognizing(false);
    }
  }, [getContentBoundingBox]);

  // Handle OCR correction confirm (from TextCorrectionOverlay)
  const handleCorrectionConfirm = useCallback(async (correctedBoxes: OCRResult[]) => {
    // PHASE C: Save corrections to correction.service
    const correctionService = getCorrectionService();
    await correctionService.initialize(); // Ensure initialized

    // Find boxes that were edited (correctedText !== recognizedText)
    const originalBoxes = ocrResults; // Store original before edits
    const editedBoxes = correctedBoxes.filter((corrected, idx) => {
      const original = originalBoxes[idx];
      return original && original.text !== corrected.text;
    });

    // Save each correction
    for (let i = 0; i < editedBoxes.length; i++) {
      const corrected = editedBoxes[i];
      const original = originalBoxes.find(o => o.id === corrected.id);

      if (original) {
        const correction: OCRCorrection = {
          id: corrected.id,
          strokeIds: [], // TODO PHASE D: Link to actual stroke IDs from history
          recognizedText: original.text,
          correctedText: corrected.text,
          timestamp: Date.now(),
          confidence: corrected.confidence,
          locale: 'en-IN' // Default locale
        };

        try {
          await correctionService.saveCorrection(correction);
        } catch (error) {
          console.error('[PenCanvas] Failed to save correction:', error);
        }
      }
    }

    // Consolidate text and trigger callback
    const fullText = correctedBoxes.map(box => box.text).join(' ');
    const avgConfidence = correctedBoxes.reduce((sum, b) => sum + b.confidence, 0) / correctedBoxes.length;

    onRecognized(fullText);

    const savedCount = editedBoxes.length;
    toast.success("Text confirmed!", {
      description: savedCount > 0
        ? `"${fullText}" (${savedCount} correction${savedCount !== 1 ? 's' : ''} saved)`
        : `"${fullText}" (avg. ${(avgConfidence * 100).toFixed(1)}%)`
    });

    setShowCorrectionOverlay(false);
    setShowOCRToast(false);

    // NOTE: History integration
    // The OCR correction is treated as a ledger entry operation, not a canvas
    // drawing operation. Undo/redo for OCR would revert the ledger entry itself,
    // which is handled by the parent component (Index.tsx or LedgerTable).
    // 
    // If we needed to undo OCR annotations on the canvas (e.g., bounding boxes),
    // we would use the createOCRCorrectionCommand() factory from history.service
    // and pass it to a canvas-level history handler. For now, this is out of scope.
  }, [onRecognized, ocrResults]);

  // Handle OCR correction cancel
  const handleCorrectionCancel = useCallback(() => {
    setShowCorrectionOverlay(false);
    toast.info("Correction cancelled");
  }, []);

  // Handle OCR edit (inline)
  const handleOCREdit = useCallback((id: string, newText: string) => {
    setOcrResults(prev => prev.map(box =>
      box.id === id ? { ...box, text: newText } : box
    ));
  }, []);

  // OCR Confirm handlers
  const handleOCRConfirm = useCallback((fields: { id: string; value: string }[]) => {
    if (!currentOCRData) return;

    // Extract the main text from fields
    const mainText = fields.find(f => f.id === 'notes')?.value ||
      fields.map(f => f.value).join(' ');

    // Create undoable command for OCR-created ledger entry
    const ocrCommand = {
      action: 'ocr-correction' as const,
      type: 'ocr' as const,
      id: `ocr_${Date.now()}`,
      data: {
        recognizedText: currentOCRData.text,
        correctedFields: fields,
        confidence: currentOCRData.confidence,
        imageHash: currentOCRData.imageHash
      },
      metadata: {
        timestamp: Date.now(),
        sessionId: sessionStorage.getItem('sessionId') || `session_${Date.now()}`
      }
    };

    // Push to history service for undo/redo support
    // Note: This is a placeholder - actual integration would use history.service
    console.log('OCR Command for history:', ocrCommand);

    // Call the parent callback with the confirmed text
    // Parent (Index.tsx) will handle actual ledger entry creation
    onRecognized(mainText);

    // Close the confirm dialog
    setShowOCRConfirm(false);
    setCurrentOCRData(null);

    toast.success('OCR result confirmed and saved to ledger');
  }, [currentOCRData, onRecognized]);

  const handleOCRCancel = useCallback(() => {
    setShowOCRConfirm(false);
    setCurrentOCRData(null);
  }, []);

  const clearResults = () => {
    setRecognitionResults([]);
    setSelectedResult(null);
    setShowStructuredData(false);
  };

  return (
    <Card className="p-4 shadow-strong bg-background">
      <div className="space-y-4">
        {/* Header */}
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-bold text-foreground">Digital Pen Input</h3>
            {recognizing && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <div className="w-2 h-2 bg-primary rounded-full animate-pulse"></div>
                Recognizing...
              </div>
            )}
            {recognitionResults.length > 0 && (
              <Badge variant="secondary" className="text-xs">
                {recognitionResults.length} result{recognitionResults.length !== 1 ? 's' : ''}
              </Badge>
            )}
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={onClose}
            className="touch-friendly"
          >
            Done
          </Button>
        </div>

        {/* Tool Palette */}
        <ToolPalette
          onUndo={undo}
          onRedo={redo}
          onClear={clearCanvas}
          onRecognize={handleHybridRecognize}
          isRecognizing={recognizing}
        />

        {/* Canvas Container */}
        <div
          ref={containerRef}
          className="relative overflow-y-auto overflow-x-hidden rounded-xl border-2 border-border shadow-lg bg-white virtual-scroll-container"
          style={{ height: '500px' }}
        >
          {/* Drawing hint */}
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center select-none" style={{ opacity: 0.1 }}>
            <div className="text-center">
              <Pen className="w-8 h-8 mx-auto mb-2 text-gray-400" />
              <span className="text-sm text-gray-500">Draw here with your pen or finger</span>
            </div>
          </div>

          {/* Background Canvas */}
          <canvas
            ref={backgroundCanvasRef}
            className="absolute top-0 left-0"
            style={{
              transform: `scale(${config.zoom}) translate(${config.pan.x}px, ${config.pan.y}px)`,
              transformOrigin: '0 0',
            }}
          />

          {/* Overlays */}
          <LassoOverlay rect={null} />
          <ShapeSnapOverlay
            shape={pendingShape}
            onConfirm={() => setPendingShape(null)}
            onCancel={() => setPendingShape(null)}
          />

          {/* NEW: Text Correction Overlay */}
          {showCorrectionOverlay && ocrResults.length > 0 && (
            <TextCorrectionOverlay
              boxes={ocrResults}
              onConfirm={handleCorrectionConfirm}
              onCancel={handleCorrectionCancel}
              onEdit={handleOCREdit}
            />
          )}

          {/* Drawing Canvas */}
          <canvas
            ref={canvasRef}
            className="absolute top-0 left-0 cursor-crosshair"
            style={{
              transform: `scale(${config.zoom}) translate(${config.pan.x}px, ${config.pan.y}px)`,
              transformOrigin: '0 0',
              touchAction: 'none', // Always capture touches for drawing — never let browser scroll/zoom interfere
              userSelect: 'none',
              WebkitUserSelect: 'none',
              WebkitTouchCallout: 'none'
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            onPointerLeave={onUp}
          />
        </div>

        {/* Recognition Results */}
        {recognitionResults.length > 0 && (
          <Card className="p-4 bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-semibold text-blue-900 dark:text-blue-100">Recognition Results</h4>
                <Button size="sm" variant="ghost" onClick={clearResults}>
                  <X className="w-4 h-4" />
                </Button>
              </div>

              <div className="space-y-2">
                {recognitionResults.map((result, index) => (
                  <div key={index} className="flex items-center justify-between p-2 bg-white dark:bg-gray-800 rounded border">
                    <div className="flex-1">
                      <span className="font-medium">{result.text}</span>
                      <span className="text-xs text-gray-500 ml-2">
                        ({(result.confidence * 100).toFixed(1)}%)
                      </span>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setSelectedResult(result)}
                      >
                        <Check className="w-3 h-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleUseResult(result)}
                      >
                        Use
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        )}

        {/* Structured Data Display */}
        {showStructuredData && selectedResult && (
          <Card className="p-4 bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800">
            <div className="space-y-2">
              <h4 className="font-semibold text-green-900 dark:text-green-100">Extracted Data</h4>
              <div className="grid grid-cols-2 gap-2 text-sm">
                {selectedResult.structuredData.amounts.length > 0 && (
                  <div>
                    <span className="font-medium">Amounts:</span>
                    <div className="text-green-700 dark:text-green-300">
                      {selectedResult.structuredData.amounts.join(', ')}
                    </div>
                  </div>
                )}
                {selectedResult.structuredData.dates.length > 0 && (
                  <div>
                    <span className="font-medium">Dates:</span>
                    <div className="text-green-700 dark:text-green-300">
                      {selectedResult.structuredData.dates.join(', ')}
                    </div>
                  </div>
                )}
                {selectedResult.structuredData.phones.length > 0 && (
                  <div>
                    <span className="font-medium">Phones:</span>
                    <div className="text-green-700 dark:text-green-300">
                      {selectedResult.structuredData.phones.join(', ')}
                    </div>
                  </div>
                )}
                {selectedResult.structuredData.emails.length > 0 && (
                  <div>
                    <span className="font-medium">Emails:</span>
                    <div className="text-green-700 dark:text-green-300">
                      {selectedResult.structuredData.emails.join(', ')}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </Card>
        )}

        {/* Action Buttons */}
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Write transaction details (e.g., "Sale ₹1000 2025-01-15")
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={clearCanvas}
              className="touch-friendly"
            >
              <RotateCcw className="w-4 h-4 mr-1" />
              Clear
            </Button>
            <Button
              size="sm"
              onClick={handleRecognizeAll}
              disabled={recognizing}
              className="touch-friendly gradient-hero"
            >
              <Zap className="w-4 h-4 mr-2" />
              Recognize All
            </Button>
          </div>
        </div>

        {/* NEW: OCR Results Toast */}
        {showOCRToast && ocrResults.length > 0 && (
          <OCRResultsToast
            summary={createOCRSummary(ocrResults)}
            onOpenCorrections={() => setShowCorrectionOverlay(true)}
            onDismiss={() => setShowOCRToast(false)}
          />
        )}

        {/* NEW: OCR Confirm Dialog */}
        {showOCRConfirm && currentOCRData && (
          <OCRConfirm
            recognizedText={currentOCRData.text}
            confidence={currentOCRData.confidence}
            imageHash={currentOCRData.imageHash}
            onConfirm={handleOCRConfirm}
            onCancel={handleOCRCancel}
          />
        )}
      </div>
    </Card>
  );
}

// Wrap with PenToolProvider to provide context
export default function PenCanvas(props: PenCanvasProps) {
  return (
    <PenToolProvider>
      <PenCanvasInner {...props} />
    </PenToolProvider>
  );
}