import React, { useRef, useEffect, useState, useCallback } from 'react';

interface WaveformSelectorProps {
  audioBuffer: AudioBuffer | null;
  onSelect: (start: number, end: number) => void;
}

const WaveformSelector: React.FC<WaveformSelectorProps> = ({ audioBuffer, onSelect }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [selection, setSelection] = useState<{ start: number, end: number } | null>(null); // in pixels
  const [dragStart, setDragStart] = useState(0);

  const drawWaveform = useCallback((buffer: AudioBuffer) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const data = buffer.getChannelData(0); // Use the first channel for visualization
    const step = Math.ceil(data.length / width);
    const amp = height / 2;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#000000';
    ctx.beginPath();

    for (let i = 0; i < width; i++) {
      let min = 1.0;
      let max = -1.0;

      for (let j = 0; j < step; j++) {
        const datum = data[(i * step) + j];
        if (datum < min) min = datum;
        if (datum > max) max = datum;
      }
      ctx.moveTo(i, (1 + min) * amp);
      ctx.lineTo(i, (1 + max) * amp);
    }
    ctx.stroke();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (audioBuffer) {
      drawWaveform(audioBuffer);
      setSelection(null);
    } else if (canvas && ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }, [audioBuffer, drawWaveform]);
  
  const drawSelection = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !audioBuffer) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Redraw waveform first
    drawWaveform(audioBuffer);

    if (selection) {
      ctx.fillStyle = 'rgba(0, 0, 128, 0.5)'; // Classic windows selection blue
      const startX = Math.min(selection.start, selection.end);
      const width = Math.abs(selection.end - selection.start);
      ctx.fillRect(startX, 0, width, canvas.height);
    }
  }, [selection, audioBuffer, drawWaveform]);

  useEffect(() => {
      drawSelection();
  }, [drawSelection]);


  const getEventX = useCallback((e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const mouseX = clientX - rect.left;
    // Scale mouse coordinate from display size to canvas internal resolution
    return (mouseX / rect.width) * canvas.width;
  }, []);
  
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!audioBuffer) return;
    setIsDragging(true);
    const x = getEventX(e);
    setDragStart(x);
    setSelection({ start: x, end: x });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDragging || !audioBuffer) return;
    const x = getEventX(e);
    setSelection({ start: dragStart, end: x });
  };

  const handleMouseUp = () => {
    if (!isDragging || !selection || !audioBuffer || !canvasRef.current) return;
    setIsDragging(false);

    const canvasWidth = canvasRef.current.width;
    const startPixel = Math.min(selection.start, selection.end);
    const endPixel = Math.max(selection.start, selection.end);

    if (endPixel - startPixel < 2) { // Ignore tiny selections
      setSelection(null);
      onSelect(0,0); // Clear selection in parent
      return;
    }

    const startTime = (startPixel / canvasWidth) * audioBuffer.duration;
    const endTime = (endPixel / canvasWidth) * audioBuffer.duration;
    
    onSelect(startTime, endTime);
  };
  
  const handleMouseLeave = () => {
      if(isDragging) {
          handleMouseUp();
      }
  }

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full bg-white cursor-ew-resize"
      width="1000"
      height="100"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onTouchStart={handleMouseDown}
      onTouchMove={handleMouseMove}
      onTouchEnd={handleMouseUp}
    />
  );
};

export default WaveformSelector;
