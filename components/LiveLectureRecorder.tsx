
import React, { useState, useRef, useEffect } from 'react';
import { VideoCameraIcon, StopIcon, ArrowPathIcon, ExclamationTriangleIcon, ComputerDesktopIcon, MicrophoneIcon } from '@heroicons/react/24/solid';
import { processLectureVideo } from '../services/geminiService';
import { StudyFile } from '../types';

interface LiveLectureRecorderProps {
  onProcessComplete: (transcript: string, videoFile: StudyFile) => void;
  onCancel: () => void;
}

const LiveLectureRecorder: React.FC<LiveLectureRecorderProps> = ({ onProcessComplete, onCancel }) => {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [timeElapsed, setTimeElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      stopStream();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const stopStream = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
  };

  const startCapture = async () => {
    setError(null);
    try {
      // Request screen share with system audio
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 1280 }, // Lower res to save bandwidth
          height: { ideal: 720 },
          frameRate: { ideal: 15 } // Slide decks don't need 60fps
        },
        audio: true // Crucial for lecture capture
      });

      // Check if audio track exists
      const audioTracks = displayStream.getAudioTracks();
      if (audioTracks.length === 0) {
        // Warn user but allow continue
        setError("No audio detected. Make sure to share a 'Tab' or 'Entire Screen' with 'Share system audio' checked.");
      }

      setStream(displayStream);
      if (videoRef.current) {
        videoRef.current.srcObject = displayStream;
      }

      // Initialize recorder
      const recorder = new MediaRecorder(displayStream, {
        mimeType: 'video/webm; codecs=vp8,opus' 
      });

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        setRecording(false);
        setProcessing(true);
        stopStream();
        if (timerRef.current) clearInterval(timerRef.current);

        const blob = new Blob(chunksRef.current, { type: 'video/webm' });
        await handleProcessing(blob);
      };

      mediaRecorderRef.current = recorder;
      
      // Start recording immediately
      recorder.start(1000); // 1s chunks
      setRecording(true);
      chunksRef.current = [];
      
      // Start timer
      setTimeElapsed(0);
      timerRef.current = window.setInterval(() => {
        setTimeElapsed(prev => prev + 1);
      }, 1000);

      // Handle user clicking "Stop Sharing" native browser button
      displayStream.getVideoTracks()[0].onended = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
          mediaRecorderRef.current.stop();
        }
      };

    } catch (err: any) {
      console.error("Capture error", err);
      setError("Failed to start screen capture. Please try again.");
    }
  };

  const stopCapture = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  };

  const handleProcessing = async (blob: Blob) => {
    try {
      // Convert blob to base64
      const reader = new FileReader();
      reader.readAsDataURL(blob);
      reader.onloadend = async () => {
        const base64data = (reader.result as string).split(',')[1];
        
        // Call Gemini Service
        const transcript = await processLectureVideo(base64data, 'video/webm');
        
        // Pass result back
        const videoFile: StudyFile = {
            name: `Lecture_Recording_${new Date().toISOString()}.webm`,
            mimeType: 'video/webm',
            data: base64data
        };
        
        onProcessComplete(transcript, videoFile);
      };
    } catch (e: any) {
      setError("AI Processing Failed: " + (e.message || "Unknown error"));
      setProcessing(false);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (processing) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center h-full">
        <div className="w-24 h-24 relative mb-6">
           <div className="absolute inset-0 border-4 border-slate-100 rounded-full"></div>
           <div className="absolute inset-0 border-4 border-indigo-600 rounded-full border-t-transparent animate-spin"></div>
           <VideoCameraIcon className="absolute inset-0 m-auto w-10 h-10 text-indigo-600 animate-pulse" />
        </div>
        <h3 className="text-2xl font-black text-indigo-900 mb-2">Analyzing Lecture</h3>
        <p className="text-slate-500 max-w-sm">
          Gemini is watching the video, extracting slide content, and transcribing the professor's speech...
        </p>
      </div>
    );
  }

  if (!stream) {
    return (
      <div className="flex flex-col items-center justify-center p-8 h-full border-2 border-dashed border-slate-200 rounded-3xl bg-slate-50/50">
        <div className="w-20 h-20 bg-white rounded-full shadow-lg flex items-center justify-center mb-6 text-rose-500">
           <VideoCameraIcon className="w-10 h-10" />
        </div>
        <h3 className="text-xl font-bold text-slate-800 mb-2">Ready to Record</h3>
        <p className="text-slate-500 text-sm max-w-xs text-center mb-8">
          Share your Zoom/Teams window or a browser tab. Make sure to check <strong>"Share system audio"</strong> so we can hear the lecturer.
        </p>
        
        {error && (
          <div className="mb-6 p-4 bg-rose-50 text-rose-700 text-xs rounded-xl flex items-center gap-2 border border-rose-100">
             <ExclamationTriangleIcon className="w-5 h-5 shrink-0" />
             {error}
          </div>
        )}

        <div className="flex gap-4">
           <button onClick={onCancel} className="px-6 py-3 rounded-xl font-bold text-slate-500 hover:bg-slate-100 transition-colors">
             Cancel
           </button>
           <button 
             onClick={startCapture}
             className="px-8 py-3 bg-rose-600 text-white rounded-xl font-bold shadow-xl shadow-rose-500/20 hover:bg-rose-700 active:scale-95 transition-all flex items-center gap-2"
           >
             <ComputerDesktopIcon className="w-5 h-5" /> Start Recording
           </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-slate-900 rounded-3xl overflow-hidden relative">
      <video 
        ref={videoRef} 
        autoPlay 
        muted 
        className="flex-1 w-full h-full object-contain bg-black"
      />
      
      {/* Overlay UI */}
      <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-black/80 to-transparent flex items-center justify-between">
         <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-red-600/90 text-white rounded-lg text-xs font-bold uppercase tracking-wider">
               <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
               REC
            </div>
            <div className="text-white font-mono text-xl font-medium">
               {formatTime(timeElapsed)}
            </div>
         </div>

         {error && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-amber-500/90 text-white px-4 py-2 rounded-full text-xs font-bold flex items-center gap-2">
               <MicrophoneIcon className="w-4 h-4" /> {error}
            </div>
         )}

         <button 
           onClick={stopCapture}
           className="px-6 py-3 bg-white text-slate-900 rounded-xl font-black uppercase tracking-widest text-xs hover:bg-slate-200 transition-all flex items-center gap-2 shadow-lg"
         >
           <StopIcon className="w-4 h-4 text-red-600" /> Finish Lecture
         </button>
      </div>
    </div>
  );
};

export default LiveLectureRecorder;
