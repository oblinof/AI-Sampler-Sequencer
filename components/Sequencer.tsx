
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { PlayIcon, PauseIcon } from './icons';
import { FX_CONFIG } from '../App';

interface SequencerProps {
  bpm: number;
  sampleBuffer: AudioBuffer | null;
  reversedSampleBuffer: AudioBuffer | null;
  audioContext: AudioContext | null;
  pattern: (string | null)[];
  onToggleStep: (index: number) => void;
  onRandomize: () => void;
  fxConfig: typeof FX_CONFIG;
}

const createImpulseResponse = (audioContext: AudioContext): AudioBuffer => {
    const sampleRate = audioContext.sampleRate;
    const duration = 2; // 2 seconds reverb tail
    const length = sampleRate * duration;
    const impulse = audioContext.createBuffer(2, length, sampleRate);
    const impulseL = impulse.getChannelData(0);
    const impulseR = impulse.getChannelData(1);

    for (let i = 0; i < length; i++) {
        const n = (length - i) / length;
        impulseL[i] = (Math.random() * 2 - 1) * Math.pow(n, 3);
        impulseR[i] = (Math.random() * 2 - 1) * Math.pow(n, 3);
    }
    return impulse;
};


const Sequencer: React.FC<SequencerProps> = ({ bpm, sampleBuffer, reversedSampleBuffer, audioContext, pattern, onToggleStep, onRandomize, fxConfig }) => {
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentStep, setCurrentStep] = useState<number>(-1);

  const timerRef = useRef<number | null>(null);
  const nextStepTimeRef = useRef<number>(0);
  const stepRef = useRef<number>(0);
  const impulseResponseRef = useRef<AudioBuffer | null>(null);
  const limiterRef = useRef<DynamicsCompressorNode | null>(null);

  useEffect(() => {
    if (audioContext && !impulseResponseRef.current) {
        impulseResponseRef.current = createImpulseResponse(audioContext);
    }
    if (audioContext && !limiterRef.current) {
        const limiter = audioContext.createDynamicsCompressor();
        limiter.threshold.setValueAtTime(-1.0, audioContext.currentTime); // Very low threshold
        limiter.knee.setValueAtTime(0, audioContext.currentTime);      // Hard knee
        limiter.ratio.setValueAtTime(20.0, audioContext.currentTime);   // High ratio
        limiter.attack.setValueAtTime(0.005, audioContext.currentTime);// Fast attack
        limiter.release.setValueAtTime(0.05, audioContext.currentTime);// Fast release
        limiter.connect(audioContext.destination);
        limiterRef.current = limiter;
    }
  }, [audioContext]);

  const scheduler = useCallback(() => {
    if (!audioContext || !limiterRef.current) return;
    const limiter = limiterRef.current;

    while (nextStepTimeRef.current < audioContext.currentTime + 0.1) {
      const fx = pattern[stepRef.current];
      if (fx && sampleBuffer) {
        const source = audioContext.createBufferSource();
        let currentNode: AudioNode = source;

        if (fx === 'reverse') {
            source.buffer = reversedSampleBuffer ?? sampleBuffer;
        } else {
            source.buffer = sampleBuffer;
        }

        const playTime = nextStepTimeRef.current;

        switch (fx) {
            case 'reverb': {
                if (impulseResponseRef.current) {
                    const convolver = audioContext.createConvolver();
                    convolver.buffer = impulseResponseRef.current;
                    currentNode.connect(convolver);
                    currentNode = convolver;
                }
                break;
            }
            case 'delay': {
                const delay = audioContext.createDelay(5.0);
                delay.delayTime.value = (60.0 / bpm) * 0.75; // Dotted 8th note delay
                const feedback = audioContext.createGain();
                feedback.gain.value = 0.4;
                const wetLevel = audioContext.createGain();
                wetLevel.gain.value = 0.5;

                currentNode.connect(delay);
                delay.connect(feedback);
                feedback.connect(delay);
                delay.connect(wetLevel);
                wetLevel.connect(limiter);
                break;
            }
            case 'pingPong': {
                const delayL = audioContext.createDelay(5.0);
                const delayR = audioContext.createDelay(5.0);
                const feedback = audioContext.createGain();
                const merger = audioContext.createChannelMerger(2);
                const splitter = audioContext.createChannelSplitter(2);

                const delayTime = (60.0 / bpm) / 2.0;
                delayL.delayTime.value = delayTime;
                delayR.delayTime.value = delayTime;
                feedback.gain.value = 0.5;

                currentNode.connect(splitter);
                splitter.connect(delayL, 0);
                splitter.connect(delayR, 1);
                
                delayL.connect(feedback);
                feedback.connect(delayR);
                delayR.connect(merger, 0, 1);
                delayL.connect(merger, 0, 0);

                currentNode = merger;
                break;
            }
            case 'glitch': {
                const stutterTime = 0.05;
                const numStutters = 3;
                for (let i = 0; i < numStutters; i++) {
                    const gain = audioContext.createGain();
                    gain.gain.setValueAtTime(1 - i / numStutters, playTime + i * stutterTime);
                    const stutterSource = audioContext.createBufferSource();
                    stutterSource.buffer = sampleBuffer;
                    stutterSource.connect(gain);
                    gain.connect(limiter);
                    stutterSource.start(playTime + i * stutterTime, 0, stutterTime);
                }
                currentNode = audioContext.createGain(); // Dummy node
                break;
            }
            case 'stutter': {
                const numRepeats = 4;
                const repeatTime = (60.0 / bpm) / 8.0; // 32nd notes
                 for (let i = 0; i < numRepeats; i++) {
                    const stutterSource = audioContext.createBufferSource();
                    stutterSource.buffer = sampleBuffer;
                    stutterSource.connect(limiter);
                    stutterSource.start(playTime + i * repeatTime, 0, repeatTime);
                }
                currentNode = audioContext.createGain(); // Dummy node
                break;
            }
             case 'tapeStop': {
                source.playbackRate.setValueAtTime(1, playTime);
                source.playbackRate.exponentialRampToValueAtTime(0.01, playTime + sampleBuffer.duration * 0.75);
                break;
            }
            case 'lowpass': {
                const filter = audioContext.createBiquadFilter();
                filter.type = 'lowpass';
                filter.frequency.value = 800;
                currentNode.connect(filter);
                currentNode = filter;
                break;
            }
            case 'highpass': {
                const filter = audioContext.createBiquadFilter();
                filter.type = 'highpass';
                filter.frequency.value = 4000;
                currentNode.connect(filter);
                currentNode = filter;
                break;
            }
            case 'bandpass': {
                const filter = audioContext.createBiquadFilter();
                filter.type = 'bandpass';
                filter.frequency.value = 1500;
                filter.Q.value = 5;
                currentNode.connect(filter);
                currentNode = filter;
                break;
            }
            case 'filterSweep': {
                const filter = audioContext.createBiquadFilter();
                filter.type = 'lowpass';
                filter.Q.value = 3;
                filter.frequency.setValueAtTime(100, playTime);
                filter.frequency.exponentialRampToValueAtTime(8000, playTime + sampleBuffer.duration);
                currentNode.connect(filter);
                currentNode = filter;
                break;
            }
            case 'phaser': {
                const allpass1 = audioContext.createBiquadFilter();
                allpass1.type = 'allpass';
                allpass1.frequency.value = 1000;
                const allpass2 = audioContext.createBiquadFilter();
                allpass2.type = 'allpass';
                allpass2.frequency.value = 1000;
                const lfo = audioContext.createOscillator();
                lfo.type = 'sine';
                lfo.frequency.value = 2;
                const lfoGain = audioContext.createGain();
                lfoGain.gain.value = 800;
                
                lfo.connect(lfoGain);
                lfoGain.connect(allpass1.frequency);
                lfoGain.connect(allpass2.frequency);
                currentNode.connect(allpass1);
                allpass1.connect(allpass2);
                currentNode = allpass2;
                lfo.start(playTime);
                lfo.stop(playTime + sampleBuffer.duration);
                break;
            }
            case 'pitchUp':
                source.playbackRate.value = 1.5;
                break;
            case 'pitchDown':
                source.playbackRate.value = 0.75;
                break;
            case 'vibrato': {
                const lfo = audioContext.createOscillator();
                lfo.type = 'sine';
                lfo.frequency.value = 5; // 5Hz vibrato
                const lfoGain = audioContext.createGain();
                lfoGain.gain.value = 15; // 15 cents detune
                lfo.connect(lfoGain);
                lfoGain.connect(source.detune);
                lfo.start(playTime);
                lfo.stop(playTime + sampleBuffer.duration);
                break;
            }
            case 'autoPan': {
                const panner = audioContext.createStereoPanner();
                const lfo = audioContext.createOscillator();
                lfo.type = 'sine';
                lfo.frequency.value = (bpm / 60) * 2; // Pan twice per beat
                lfo.connect(panner.pan);
                currentNode.connect(panner);
                currentNode = panner;
                lfo.start(playTime);
                lfo.stop(playTime + sampleBuffer.duration);
                break;
            }
            case 'gate': {
                const gateGain = audioContext.createGain();
                gateGain.gain.setValueAtTime(0, playTime);
                const stepDuration = 60.0 / bpm / 4.0;
                gateGain.gain.linearRampToValueAtTime(1, playTime + stepDuration * 0.05);
                gateGain.gain.setValueAtTime(1, playTime + stepDuration * 0.45);
                gateGain.gain.linearRampToValueAtTime(0, playTime + stepDuration * 0.5);
                currentNode.connect(gateGain);
                currentNode = gateGain;
                break;
            }
            case 'bitcrusher': {
                const crusher = audioContext.createWaveShaper();
                const bits = 4; // 4-bit resolution
                const norm_freq = 0.1;
                const step = Math.pow(0.5, bits);
                const phaser_ = new Float32Array(1);
                const last_val = new Float32Array(1);
                const curve = new Float32Array(65536);
                for(let i=-32768; i<32768; i++) {
                    phaser_[0] += norm_freq;
                    if(phaser_[0] >= 1.0) {
                        phaser_[0] -= 1.0;
                        last_val[0] = step * Math.floor( (i/32768) / step + 0.5);
                    }
                    curve[i+32768] = last_val[0];
                }
                crusher.curve = curve;
                currentNode.connect(crusher);
                currentNode = crusher;
                break;
            }
            case 'stereoWiden': {
                 if (audioContext.createStereoPanner) { // Check for browser support
                    const splitter = audioContext.createChannelSplitter(2);
                    const merger = audioContext.createChannelMerger(2);
                    const delay = audioContext.createDelay();
                    delay.delayTime.value = 0.01; // 10ms delay
                    
                    currentNode.connect(splitter);
                    splitter.connect(delay, 0);
                    delay.connect(merger, 0, 0); // Delayed left to left output
                    splitter.connect(merger, 1, 1); // Original right to right output
                    currentNode = merger;
                }
                break;
            }
        }
        
        if (fx !== 'glitch' && fx !== 'stutter') {
            currentNode.connect(limiter);
            source.start(playTime);
        }
      }
      
      const secondsPerStep = 60.0 / bpm / 4.0;
      nextStepTimeRef.current += secondsPerStep;
      
      setCurrentStep(stepRef.current);
      stepRef.current = (stepRef.current + 1) % 16;
    }
    
    timerRef.current = window.setTimeout(scheduler, 25.0);
  }, [audioContext, bpm, pattern, sampleBuffer, reversedSampleBuffer]);


  useEffect(() => {
    if (isPlaying) {
      if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume();
      }
      stepRef.current = 0;
      nextStepTimeRef.current = audioContext?.currentTime || 0;
      scheduler();
    } else {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setCurrentStep(-1);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isPlaying, scheduler, audioContext]);
  
  const handlePlayToggle = () => {
      if (!sampleBuffer) return; // Can't play without a sample
      setIsPlaying(prev => !prev);
  }

  return (
    <div className="w-full">
        <div className="flex items-center gap-4 mb-4">
            <button 
                onClick={handlePlayToggle}
                disabled={!sampleBuffer}
                className="p-3 win-button"
            >
                {isPlaying ? <PauseIcon /> : <PlayIcon />}
            </button>
            <button
                onClick={onRandomize}
                disabled={!sampleBuffer}
                className="win-button text-sm px-4 py-2"
            >
                Randomize
            </button>
        </div>
        <div className="grid grid-cols-16 gap-1.5">
            {pattern.map((fx, index) => {
                const fxStyle = fx ? fxConfig[fx]?.color || '' : '';
                const baseClasses = `h-20 w-full win-button p-0 transition-colors duration-100`;
                const activeClasses = fx === 'normal' ? 'win-button-active' : fxStyle;

                const stepClasses = `
                    ${baseClasses}
                    ${fx ? activeClasses : ''}
                    ${currentStep === index ? 'outline outline-2 outline-offset-[-2px] outline-black' : ''}
                `;
                return (
                    <button
                        key={index}
                        onClick={() => onToggleStep(index)}
                        className={stepClasses}
                        aria-label={`Step ${index + 1}`}
                    />
                );
            })}
        </div>
    </div>
  );
};

export default Sequencer;
