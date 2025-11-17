
import React, { useState, useRef } from 'react';
import { generateAudio } from './services/geminiService';
import { decodeBase64, decodePCMAudioData, exportToWav } from './services/audioUtils';
import { LoadingSpinner, PlayIcon, PauseIcon, DownloadIcon, LoadIcon, StopIcon } from './components/icons';
import WaveformSelector from './components/WaveformSelector';
import Sequencer from './components/Sequencer';

// Define the configuration for each available effect
export const FX_CONFIG: Record<string, { name: string; color: string; hoverColor: string; activeColor: string }> = {
  normal: { name: 'Normal', color: 'win-button-active', hoverColor: '', activeColor: '' }, // Special case for styling
  reverb: { name: 'Reverb', color: 'bg-blue-500', hoverColor: 'hover:bg-blue-600', activeColor: 'bg-blue-600' },
  delay: { name: 'Delay', color: 'bg-green-500', hoverColor: 'hover:bg-green-600', activeColor: 'bg-green-600' },
  reverse: { name: 'Reverse', color: 'bg-purple-500', hoverColor: 'hover:bg-purple-600', activeColor: 'bg-purple-600' },
  glitch: { name: 'Glitch', color: 'bg-orange-500', hoverColor: 'hover:bg-orange-600', activeColor: 'bg-orange-600' },
  lowpass: { name: 'Lowpass', color: 'bg-teal-500', hoverColor: 'hover:bg-teal-600', activeColor: 'bg-teal-600' },
  highpass: { name: 'Highpass', color: 'bg-yellow-500', hoverColor: 'hover:bg-yellow-600', activeColor: 'bg-yellow-600' },
  bandpass: { name: 'Bandpass', color: 'bg-lime-500', hoverColor: 'hover:bg-lime-600', activeColor: 'bg-lime-600' },
  phaser: { name: 'Phaser', color: 'bg-pink-500', hoverColor: 'hover:bg-pink-600', activeColor: 'bg-pink-600' },
  stutter: { name: 'Stutter', color: 'bg-indigo-500', hoverColor: 'hover:bg-indigo-600', activeColor: 'bg-indigo-600' },
  pitchUp: { name: 'Pitch Up', color: 'bg-cyan-500', hoverColor: 'hover:bg-cyan-600', activeColor: 'bg-cyan-600' },
  pitchDown: { name: 'Pitch Down', color: 'bg-amber-500', hoverColor: 'hover:bg-amber-600', activeColor: 'bg-amber-600' },
  autoPan: { name: 'Auto Pan', color: 'bg-rose-500', hoverColor: 'hover:bg-rose-600', activeColor: 'bg-rose-600' },
  gate: { name: 'Gate', color: 'bg-violet-500', hoverColor: 'hover:bg-violet-600', activeColor: 'bg-violet-600' },
  bitcrusher: { name: 'Bitcrush', color: 'bg-gray-500', hoverColor: 'hover:bg-gray-600', activeColor: 'bg-gray-600' },
  pingPong: { name: 'Ping Pong', color: 'bg-fuchsia-500', hoverColor: 'hover:bg-fuchsia-600', activeColor: 'bg-fuchsia-600' },
  filterSweep: { name: 'Sweep', color: 'bg-sky-500', hoverColor: 'hover:bg-sky-600', activeColor: 'bg-sky-600' },
  vibrato: { name: 'Vibrato', color: 'bg-emerald-500', hoverColor: 'hover:bg-emerald-600', activeColor: 'bg-emerald-600' },
  tapeStop: { name: 'Tape Stop', color: 'bg-orange-700', hoverColor: 'hover:bg-orange-800', activeColor: 'bg-orange-800' },
  stereoWiden: { name: 'Widen', color: 'bg-stone-500', hoverColor: 'hover:bg-stone-600', activeColor: 'bg-stone-600' },
};


const AudioVisualizer: React.FC<{ analyser: AnalyserNode | null; isPlaying: boolean }> = ({ analyser, isPlaying }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameId = useRef<number>();

  const draw = React.useCallback(() => {
    if (!analyser || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const canvasCtx = canvas.getContext('2d');
    if (!canvasCtx) return;

    analyser.fftSize = 2048;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const drawLoop = () => {
      animationFrameId.current = requestAnimationFrame(drawLoop);
      analyser.getByteTimeDomainData(dataArray);

      canvasCtx.fillStyle = 'rgba(255, 255, 255, 0.1)';
      canvasCtx.fillRect(0, 0, canvas.width, canvas.height);

      canvasCtx.lineWidth = 2;
      canvasCtx.strokeStyle = '#000000';
      canvasCtx.beginPath();

      const sliceWidth = (canvas.width * 1.0) / bufferLength;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = (v * canvas.height) / 2;

        if (i === 0) {
          canvasCtx.moveTo(x, y);
        } else {
          canvasCtx.lineTo(x, y);
        }
        x += sliceWidth;
      }

      canvasCtx.lineTo(canvas.width, canvas.height / 2);
      canvasCtx.stroke();
    };

    if (isPlaying) {
        drawLoop();
    } else {
        if (animationFrameId.current) {
             cancelAnimationFrame(animationFrameId.current);
        }
        canvasCtx.fillStyle = '#ffffff';
        canvasCtx.fillRect(0, 0, canvas.width, canvas.height);
        canvasCtx.strokeStyle = '#000000';
        canvasCtx.beginPath();
        canvasCtx.moveTo(0, canvas.height/2);
        canvasCtx.lineTo(canvas.width, canvas.height/2);
        canvasCtx.stroke();
    }
    
    return () => {
        if(animationFrameId.current) {
            cancelAnimationFrame(animationFrameId.current);
        }
    }
  }, [analyser, isPlaying]);
  
  React.useEffect(() => {
      const cleanup = draw();
      return cleanup;
  }, [draw]);

  return <canvas ref={canvasRef} className="w-full h-full bg-white" />;
};


const App: React.FC = () => {
  const [prompt, setPrompt] = useState<string>('lo-fi hip hop beat, chill, vinyl crackle');
  const [bpm, setBpm] = useState<number>(90);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  
  const [generatedAudioBuffer, setGeneratedAudioBuffer] = useState<AudioBuffer | null>(null);
  const [isGeneratedAudioPlaying, setIsGeneratedAudioPlaying] = useState<boolean>(false);
  const [selection, setSelection] = useState<{ start: number, end: number } | null>(null);
  
  // Sequencer state
  const [sequencerSample, setSequencerSample] = useState<AudioBuffer | null>(null);
  const [reversedSequencerSample, setReversedSequencerSample] = useState<AudioBuffer | null>(null);
  const [pattern, setPattern] = useState<(string | null)[]>(Array(16).fill(null));
  const [selectedFx, setSelectedFx] = useState<string>('normal');


  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  const initAudioContext = () => {
    if (!audioContextRef.current) {
      const context = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = context;
      const analyser = context.createAnalyser();
      analyser.connect(context.destination);
      analyserRef.current = analyser;
    }
    if (audioContextRef.current.state === 'suspended') {
        audioContextRef.current.resume();
    }
  };

  const handleToggleStep = (index: number) => {
    const newPattern = [...pattern];
    // If the step already has the selected effect, turn it off.
    if (newPattern[index] === selectedFx) {
        newPattern[index] = null;
    } else { // Otherwise, apply the selected effect.
        newPattern[index] = selectedFx;
    }
    setPattern(newPattern);
  };
  
  const handleRandomizePattern = () => {
    let newPattern;
    const isSamePattern = (p1: (string|null)[], p2: (string|null)[]) => p1.join(',') === p2.join(',');
    
    // Create a pool of possible states for a step. Skew towards inactive (null).
    const possibleStates = [...Object.keys(FX_CONFIG), null, null, null, null, null, null];
    
    do {
      newPattern = Array(16).fill(null).map(() => possibleStates[Math.floor(Math.random() * possibleStates.length)]);
    } while (isSamePattern(newPattern, pattern) || newPattern.every(step => step === null));

    setPattern(newPattern);
  };


  const handleGenerate = async () => {
    initAudioContext();
    if (!audioContextRef.current) {
        setError("Audio context could not be initialized.");
        return;
    }

    setIsLoading(true);
    setError(null);
    if(isGeneratedAudioPlaying) handleStopGeneratedAudio();
    setGeneratedAudioBuffer(null);
    setSequencerSample(null);
    setReversedSequencerSample(null);
    setSelection(null);
    setPattern(Array(16).fill(null)); // Reset pattern on new generation

    try {
      const base64Audio = await generateAudio(prompt, bpm);
      const audioBytes = decodeBase64(base64Audio);
      const audioBuffer = await decodePCMAudioData(audioBytes, audioContextRef.current);
      setGeneratedAudioBuffer(audioBuffer);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unknown error occurred.');
    } finally {
      setIsLoading(false);
    }
  };

  const playGeneratedAudio = (buffer: AudioBuffer) => {
    if (!audioContextRef.current || !analyserRef.current) return;
    if (audioSourceRef.current) {
        audioSourceRef.current.stop();
    }
    const source = audioContextRef.current.createBufferSource();
    source.buffer = buffer;
    source.connect(analyserRef.current);
    source.onended = () => setIsGeneratedAudioPlaying(false);
    source.start(0);
    audioSourceRef.current = source;
  };

  const handlePlayPauseGeneratedAudio = () => {
    if (!generatedAudioBuffer) return;
    initAudioContext();

    if (isGeneratedAudioPlaying) {
      if (audioSourceRef.current) {
        audioSourceRef.current.stop();
      }
      setIsGeneratedAudioPlaying(false);
    } else {
      setIsGeneratedAudioPlaying(true);
      playGeneratedAudio(generatedAudioBuffer);
    }
  };
  
  const handleStopGeneratedAudio = () => {
    if(audioSourceRef.current) {
        audioSourceRef.current.stop();
        audioSourceRef.current = null;
    }
    setIsGeneratedAudioPlaying(false);
  };
  
  const handleLoadToSequencer = () => {
    if (!generatedAudioBuffer || !selection || !audioContextRef.current) return;
    
    const { start, end } = selection;
    const sampleRate = generatedAudioBuffer.sampleRate;
    const startFrame = Math.floor(start * sampleRate);
    const endFrame = Math.floor(end * sampleRate);
    const frameCount = endFrame - startFrame;
    
    if (frameCount <= 0) return;

    // Create normal buffer
    const newBuffer = audioContextRef.current.createBuffer(
      generatedAudioBuffer.numberOfChannels,
      frameCount,
      sampleRate
    );
    // Create reversed buffer
    const reversedBuffer = audioContextRef.current.createBuffer(
      generatedAudioBuffer.numberOfChannels,
      frameCount,
      sampleRate
    );

    for (let i = 0; i < generatedAudioBuffer.numberOfChannels; i++) {
      const channelData = generatedAudioBuffer.getChannelData(i).slice(startFrame, endFrame);
      
      // Set normal data
      newBuffer.getChannelData(i).set(channelData);

      // Create a reversed copy for the reversed buffer
      const reversedChannelData = channelData.slice().reverse();
      reversedBuffer.getChannelData(i).set(reversedChannelData);
    }

    setSequencerSample(newBuffer);
    setReversedSequencerSample(reversedBuffer);
  };

  const exportSequence = async () => {
    if (!sequencerSample || !audioContextRef.current) return;

    const sampleRate = audioContextRef.current.sampleRate;
    
    // Calculate timing
    const secondsPerStep = 60.0 / bpm / 4.0;
    const totalDuration = secondsPerStep * 16;
    const totalFrames = Math.floor(totalDuration * sampleRate);

    // Use OfflineAudioContext for robust, non-real-time rendering
    const offlineContext = new OfflineAudioContext(
        sequencerSample.numberOfChannels,
        totalFrames,
        sampleRate
    );

    // This is a simplified export and won't include FX.
    // A full FX export would require rebuilding the entire FX chain inside the offline context.
    for (let i = 0; i < 16; i++) {
        if (pattern[i]) {
            const startTime = i * secondsPerStep;
            const source = offlineContext.createBufferSource();
            // Use reversed buffer if effect is 'reverse'
            source.buffer = (pattern[i] === 'reverse' && reversedSequencerSample) ? reversedSequencerSample : sequencerSample;
            source.connect(offlineContext.destination);
            source.start(startTime);
        }
    }

    try {
        const renderedBuffer = await offlineContext.startRendering();
        const wavBlob = exportToWav(renderedBuffer);
        const url = URL.createObjectURL(wavBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `sequence_${bpm}bpm.wav`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (err) {
        console.error("Error rendering sequence:", err);
        setError("Could not render the sequence. Please try again.");
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center p-4 sm:p-6 md:p-8">
      <div className="w-full max-w-5xl mx-auto">
        
        <header className="text-center mb-8">
          <h1 className="text-4xl sm:text-5xl font-bold">
            AI Sample Sequencer
          </h1>
          <p className="text-gray-700 mt-2">metamodel your sound</p>
        </header>

        <main className="win-panel">
          <div className="flex flex-col md:flex-row gap-6">

            {/* Controls */}
            <div className="md:w-1/3 space-y-6">
              <div className="space-y-2">
                <label htmlFor="prompt" className="font-semibold">Prompt</label>
                <textarea
                  id="prompt"
                  rows={4}
                  className="w-full win-input"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="e.g., funky disco beat"
                />
              </div>

              <div className="space-y-2">
                 <label htmlFor="bpm" className="font-semibold flex justify-between">
                    <span>BPM</span>
                    <span className="font-mono">{bpm}</span>
                </label>
                <input
                  id="bpm"
                  type="range"
                  min="20"
                  max="300"
                  value={bpm}
                  onChange={(e) => setBpm(Number(e.target.value))}
                  className="w-full win-slider"
                />
              </div>
              
              <button
                onClick={handleGenerate}
                disabled={isLoading}
                className="w-full flex items-center justify-center gap-2 win-button"
              >
                {isLoading ? <><LoadingSpinner /> Generating...</> : 'Generate Music'}
              </button>
              {error && <p className="text-red-600 text-sm mt-2">{error}</p>}
            </div>

            {/* Player & Sampler */}
            <div className="md:w-2/3 flex flex-col gap-4">
               <div className="h-28 w-full win-panel-inset">
                  <AudioVisualizer analyser={analyserRef.current} isPlaying={isGeneratedAudioPlaying} />
               </div>
               <div className="flex items-center justify-center gap-4">
                 <button onClick={handlePlayPauseGeneratedAudio} disabled={!generatedAudioBuffer || isLoading} className="p-3 win-button">
                    { isGeneratedAudioPlaying ? <PauseIcon /> : <PlayIcon /> }
                 </button>
                 <button onClick={handleStopGeneratedAudio} disabled={!isGeneratedAudioPlaying} className="p-3 win-button">
                    <StopIcon />
                 </button>
               </div>
               <div className="h-28 w-full win-panel-inset">
                 <WaveformSelector audioBuffer={generatedAudioBuffer} onSelect={(start, end) => setSelection({ start, end })} />
               </div>
                <button onClick={handleLoadToSequencer} disabled={!selection || !generatedAudioBuffer} className="w-full flex items-center justify-center gap-2 win-button">
                    <LoadIcon /> Load Sample to Sequencer
                </button>
            </div>
          </div>
        </main>
        
        <section className="mt-8 win-panel">
            <h3 className="text-xl font-bold mb-2">Step Sequencer</h3>
             <div className="mb-4 p-2 win-panel-inset bg-gray-300">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold mr-2">FX:</span>
                    {Object.entries(FX_CONFIG).map(([id, { name, color, activeColor }]) => {
                        const isSelected = selectedFx === id;
                        const baseClasses = "text-sm text-black px-3 py-1 win-button";
                        const selectedClasses = id === 'normal' ? 'win-button-active' : `!border-black ${activeColor} text-white`;
                        return (
                            <button key={id} onClick={() => setSelectedFx(id)} className={`${baseClasses} ${isSelected ? selectedClasses : ''} ${id !== 'normal' && color}`}>
                                {name}
                            </button>
                        );
                    })}
                </div>
            </div>

            <Sequencer 
                bpm={bpm} 
                sampleBuffer={sequencerSample} 
                reversedSampleBuffer={reversedSequencerSample}
                audioContext={audioContextRef.current}
                pattern={pattern}
                onToggleStep={handleToggleStep}
                onRandomize={handleRandomizePattern}
                fxConfig={FX_CONFIG}
            />
            {sequencerSample && (
                 <div className="mt-4 text-center">
                    <button onClick={exportSequence} className="flex items-center justify-center gap-2 mx-auto text-sm win-button">
                        <DownloadIcon size={16}/> Export Sequence
                    </button>
                 </div>
            )}
        </section>
      </div>
    </div>
  );
};

export default App;