// FIX: Imported LiveMusicServerMessage and LiveMusicSession from @google/genai to resolve type errors.
import { GoogleGenAI, LiveMusicServerMessage, LiveMusicSession } from '@google/genai';
import { decodeBase64 } from './audioUtils';

// The local interface definitions for LiveMusicSession and LiveMusicServerMessage were removed
// and replaced with the official types from the @google/genai SDK.

if (!process.env.API_KEY) {
    throw new Error("API_KEY environment variable not set");
}

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
const musicModel = 'lyria-realtime-exp';

/**
 * Generates a loop of music using a real-time music generation model.
 * It connects to a streaming service, waits for the first audio chunk,
 * captures audio for a fixed duration, and returns the complete audio as a base64 string.
 * @param prompt The musical description.
 * @param bpm The desired beats per minute.
 * @returns A promise that resolves with the base64 encoded audio data.
 */
export async function generateAudio(prompt: string, bpm: number): Promise<string> {
    return new Promise(async (resolve, reject) => {
        let session: LiveMusicSession;
        const audioChunks: Uint8Array[] = [];
        let totalByteLength = 0;
        
        const collectionDurationMs = 8000; // How long to record audio for once it starts.
        const initialConnectionTimeoutMs = 15000; // Max wait time for the first audio chunk.

        let collectionTimeout: number;
        let initialTimeout: number;
        let sessionClosed = false;
        let hasReceivedAudio = false;

        const cleanupAndResolve = () => {
            if (sessionClosed) return;
            sessionClosed = true;
            clearTimeout(collectionTimeout);
            clearTimeout(initialTimeout);
            if (session) {
                try {
                    session.close();
                } catch (e) { console.warn("Error closing session:", e); }
            }

            if (audioChunks.length === 0) {
                reject(new Error("Music generation did not produce any audio. The model may be warming up. Please try again in a moment."));
                return;
            }

            const fullAudio = new Uint8Array(totalByteLength);
            let offset = 0;
            for (const chunk of audioChunks) {
                fullAudio.set(chunk, offset);
                offset += chunk.length;
            }

            // Convert final Uint8Array to base64 string
            let binary = '';
            const len = fullAudio.byteLength;
            for (let i = 0; i < len; i++) {
                binary += String.fromCharCode(fullAudio[i]);
            }
            resolve(btoa(binary));
        };
        
        try {
            // The 'ai.live.music' property is part of an experimental API
            // and may not be present in the public SDK types, hence the @ts-ignore.
            // @ts-ignore
            session = await ai.live.music.connect({
                model: musicModel,
                callbacks: {
                    onmessage: (message: LiveMusicServerMessage) => {
                        // FIX: Process all audio chunks received from the server, not just the first one.
                        if (message.serverContent?.audioChunks) {
                            // When the first chunk arrives, start the timer to define collection duration.
                            if (!hasReceivedAudio) {
                                hasReceivedAudio = true;
                                clearTimeout(initialTimeout); // Cancel the initial timeout
                                collectionTimeout = window.setTimeout(cleanupAndResolve, collectionDurationMs);
                            }

                            for (const audioChunk of message.serverContent.audioChunks) {
                                if (audioChunk.data) {
                                    const chunk = decodeBase64(audioChunk.data);
                                    audioChunks.push(chunk);
                                    totalByteLength += chunk.length;
                                }
                            }
                        }
                         if (message.filteredPrompt) {
                            console.warn(`Prompt filtered: ${message.filteredPrompt.text}, Reason: ${message.filteredPrompt.filteredReason}`);
                        }
                    },
                    onerror: (e: ErrorEvent) => {
                        console.error('Session error:', e);
                        reject(new Error('A session error occurred. Please check the console for details.'));
                        cleanupAndResolve();
                    },
                    onclose: () => {
                        // This can be called by the server or by session.close(). 
                        // The sessionClosed flag prevents redundant processing.
                        if (!sessionClosed) {
                             console.log('Session closed unexpectedly by server.');
                             cleanupAndResolve();
                        }
                    },
                },
            });

            // FIX: The `onopen` callback is not supported by the Lyria music API.
            // Session setup logic is moved here to execute after the connection is established.
            try {
                await session.setMusicGenerationConfig({ musicGenerationConfig: { bpm } });
                await session.setWeightedPrompts({ weightedPrompts: [{ text: prompt, weight: 1.0 }] });
                session.play();
                
                // Set a timeout for receiving the first audio chunk.
                initialTimeout = window.setTimeout(() => {
                    if (!hasReceivedAudio) {
                        console.warn("Initial connection timed out. No audio received.");
                        cleanupAndResolve();
                    }
                }, initialConnectionTimeoutMs);
            } catch (err) {
                console.error("Error during session setup:", err);
                reject(err);
                cleanupAndResolve();
            }
        } catch (err) {
            clearTimeout(initialTimeout);
            clearTimeout(collectionTimeout);
            reject(err);
        }
    });
}