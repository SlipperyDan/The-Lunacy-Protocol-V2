import React, { useState, useEffect, useRef, useMemo } from 'react';
import { GoogleGenAI, Modality } from "@google/genai";
import { auth, db, googleProvider } from './firebase';
import { signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { analyzeVideo, transcribeAudio } from './services/geminiService';
import { 
  Activity, 
  Search, 
  Mic, 
  MicOff, 
  Terminal, 
  BarChart3, 
  History, 
  Cpu, 
  Zap, 
  Shield, 
  Sword, 
  Target,
  Download,
  RefreshCw,
  ChevronRight,
  AlertCircle,
  Clock,
  User,
  LayoutDashboard
} from 'lucide-react';
import { 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  AreaChart,
  Area,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis
} from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';
import audioProcessorUrl from './audio-processor?url';

function App() {
  const [user, setUser] = useState<any>(null);
  const [telemetry, setTelemetry] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [gameName, setGameName] = useState('Banana Tyrant');
  const [tagLine, setTagLine] = useState('Snail');
  const [region, setRegion] = useState('americas');
  const [searchedProfile, setSearchedProfile] = useState({ name: '', tag: '' });
  const [matches, setMatches] = useState<any[]>([]);
  const [championFilter, setChampionFilter] = useState('');
  const [scanning, setScanning] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');

  const [activeTab, setActiveTab] = useState<'dashboard' | 'history' | 'live'>('dashboard');
  const [analysisResult, setAnalysisResult] = useState<string>('');

  const handleVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64 = (event.target?.result as string).split(',')[1];
      const result = await analyzeVideo(base64, file.type, "Analyze this match video for mechanical skill and key moments.");
      setAnalysisResult(result || "No analysis generated.");
    };
    reader.readAsDataURL(file);
  };

  const handleAudioUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64 = (event.target?.result as string).split(',')[1];
      const result = await transcribeAudio(base64, file.type);
      setAnalysisResult(result || "No transcription generated.");
    };
    reader.readAsDataURL(file);
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        // Ensure user document exists
        setDoc(doc(db, 'users', currentUser.uid), {
          uid: currentUser.uid,
          email: currentUser.email,
          displayName: currentUser.displayName
        }, { merge: true });
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const getDevices = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter(device => device.kind === 'audioinput');
        setAvailableMicrophones(audioInputs);
        if (audioInputs.length > 0 && !selectedMicrophoneId) {
          setSelectedMicrophoneId(audioInputs[0].deviceId);
        }
      } catch (err) {
        console.error("Error enumerating devices:", err);
      }
    };
    getDevices();
    navigator.mediaDevices.addEventListener('devicechange', getDevices);
    return () => navigator.mediaDevices.removeEventListener('devicechange', getDevices);
  }, []);

  const winProbData = useMemo(() => {
    if (!telemetry?.winProbabilityTimeline) return [];
    return telemetry.winProbabilityTimeline.map((prob: number, i: number) => ({
      minute: i,
      probability: Math.round(prob * 100)
    }));
  }, [telemetry]);

  const comparativeData = useMemo(() => {
    if (!telemetry?.forensics) return [];
    return [
      { subject: 'Damage', A: parseFloat(telemetry.forensics.damageShare) || 0, fullMark: 100 },
      { subject: 'Tank', A: parseFloat(telemetry.forensics.tankShare) || 0, fullMark: 100 },
      { subject: 'Tower', A: parseFloat(telemetry.forensics.towerShare) || 0, fullMark: 100 },
      { subject: 'Agency', A: parseFloat(telemetry.forensics.agencyRatio) || 0, fullMark: 100 },
    ];
  }, [telemetry]);

  // Live Transcription States
  const [isRecording, setIsRecording] = useState(false);
  const [selectedMicrophoneId, setSelectedMicrophoneId] = useState<string>('');
  const [availableMicrophones, setAvailableMicrophones] = useState<MediaDeviceInfo[]>([]);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [liveTranscript, setLiveTranscript] = useState<{time: string, text: string, isInterim?: boolean}[]>([]);
  const [audioLevel, setAudioLevel] = useState(0);
  const recordingStartTime = useRef<number>(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sessionRef = useRef<any>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<AudioWorkletNode | null>(null);

  const fetchTelemetry = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/telemetry?_t=${Date.now()}`, { cache: 'no-store' });
      const contentType = res.headers.get("content-type");
      
      if (!res.ok) {
          let errorMessage = `Telemetry fetch failed: ${res.status}`;
          if (contentType && contentType.includes("application/json")) {
              const errorData = await res.json();
              errorMessage = errorData.error || errorData.message || errorMessage;
          } else {
              const text = await res.text();
              console.error("Server returned non-JSON error:", text.substring(0, 100));
          }
          throw new Error(errorMessage);
      }
      
      const data = await res.json();
      setTelemetry(data);
    } catch (error: any) {
      console.error("Failed to fetch telemetry:", error);
      setError(`TELEMETRY_SYNC_ERROR: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const performScan = async (name: string, tag: string) => {
      if (!name || !tag) return;
      
      setScanning(true);
      setError('');
      setMatches([]);
      
      try {
          const res = await fetch(`/api/matches?_t=${Date.now()}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ gameName: name, tagLine: tag, region }),
              cache: 'no-store'
          });
          
          const contentType = res.headers.get("content-type");
          if (!res.ok) {
              let errorMessage = `Scan failed: ${res.status}`;
              if (contentType && contentType.includes("application/json")) {
                  const errorData = await res.json();
                  errorMessage = errorData.error || errorData.message || errorMessage;
              } else {
                  const text = await res.text();
                  console.error("Server returned non-JSON error:", text.substring(0, 100));
              }
              throw new Error(errorMessage);
          }
          
          const data = await res.json();
          setMatches(data);
          setSearchedProfile({ name, tag });
      } catch (err: any) {
          setError(err.message);
      } finally {
          setScanning(false);
      }
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const transcriptInputRef = useRef<HTMLInputElement>(null);
  const [selectedMatch, setSelectedMatch] = useState<{matchId: string, puuid: string} | null>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files[0] && selectedMatch) {
          generateReport(selectedMatch.matchId, selectedMatch.puuid, e.target.files[0]);
      }
      if (fileInputRef.current) fileInputRef.current.value = '';
      setSelectedMatch(null);
  };

  const handleTranscriptSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files[0] && selectedMatch) {
          generateReport(selectedMatch.matchId, selectedMatch.puuid, undefined, e.target.files[0]);
      }
      if (transcriptInputRef.current) transcriptInputRef.current.value = '';
      setSelectedMatch(null);
  };

  const triggerUpload = (matchId: string, puuid: string) => {
      setSelectedMatch({ matchId, puuid });
      fileInputRef.current?.click();
  };

  const triggerTranscriptUpload = (matchId: string, puuid: string) => {
      setSelectedMatch({ matchId, puuid });
      transcriptInputRef.current?.click();
  };

  const getMicrophoneStream = async () => {
      return await navigator.mediaDevices.getUserMedia({ 
          audio: {
              deviceId: selectedMicrophoneId ? { exact: selectedMicrophoneId } : undefined,
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
              channelCount: 1,
              sampleRate: 16000
          } 
      });
  };

  const startLiveRecording = async () => {
      try {
          const apiKey = (window as any).process?.env?.GEMINI_API_KEY || (window as any).process?.env?.API_KEY;
          if (!apiKey) {
              setError("GEMINI_API_KEY_MISSING: Cannot start live transcription.");
              return;
          }

          const ai = new GoogleGenAI({ apiKey });
          const stream = await getMicrophoneStream();
          audioStreamRef.current = stream;

          const audioContext = new AudioContext({ sampleRate: 16000 });
          if (audioContext.state === 'suspended') {
              await audioContext.resume();
          }
          audioContextRef.current = audioContext;
          const source = audioContext.createMediaStreamSource(stream);
          await audioContext.audioWorklet.addModule(audioProcessorUrl);
          const workletNode = new AudioWorkletNode(audioContext, 'audio-processor');
          processorRef.current = workletNode;

          // Analyzer for VU Meter
          const analyser = audioContext.createAnalyser();
          analyser.fftSize = 256;
          source.connect(analyser);
          const dataArray = new Uint8Array(analyser.frequencyBinCount);

          const updateLevel = () => {
              if (!isRecording) return;
              analyser.getByteFrequencyData(dataArray);
              const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
              setAudioLevel(average);
              requestAnimationFrame(updateLevel);
          };

          const sessionPromise = ai.live.connect({
              model: "gemini-2.5-flash-native-audio-preview-09-2025",
              config: {
                  responseModalities: [Modality.AUDIO],
                  systemInstruction: `You are a specialized League of Legends tactical transcriber. 
                  Your task is to accurately capture the player's callouts, strategy, and emotional state. 
                  Be precise with champion names, items, and game terminology (e.g., 'gank', 'objective', 'rotation', 'tilt'). 
                  Do not speak or add your own commentary. Only provide transcriptions via the STT service.`,
                  inputAudioTranscription: {
                      // Native STT enabled
                  }
              },
              callbacks: {
                  onopen: () => {
                      console.log("Live session opened");
                      setIsRecording(true);
                      recordingStartTime.current = Date.now();
                      setLiveTranscript([]);
                      updateLevel();
                  },
                  onmessage: (message: any) => {
                      console.log("DEBUG_LIVE_MSG:", message);
                      
                      // 1. Capture Interim (Partial) Transcription
                      const interimText = message.inputAudioTranscription?.text || 
                                        message.serverContent?.inputAudioTranscription?.text;
                      
                      if (interimText) {
                          updateInterimTranscript(interimText);
                      }
                      
                      // 2. Capture Stable (Finalized) Transcription
                      const stableText = message.inputTranscription?.text ||
                                       message.serverContent?.userContent?.parts?.[0]?.text || 
                                       message.userContent?.parts?.[0]?.text;
                      
                      if (stableText) {
                          commitTranscriptLine(stableText);
                      }
                  },
                  onerror: (err) => {
                      console.error("Live session error:", err);
                      setError(`LIVE_SESSION_ERROR: ${err.message}`);
                      stopLiveRecording();
                  },
                  onclose: () => {
                      console.log("Live session closed");
                      setIsRecording(false);
                      // Attempt to reconnect if recording is still intended
                      if (isRecording) {
                          console.log("Attempting to reconnect...");
                          setTimeout(startLiveRecording, 2000);
                      }
                  }
              }
          });

          const updateInterimTranscript = (text: string) => {
              const elapsed = Math.floor((Date.now() - recordingStartTime.current) / 1000);
              const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
              const seconds = (elapsed % 60).toString().padStart(2, '0');
              const timeStr = `${minutes}:${seconds}`;

              setLiveTranscript(prev => {
                  if (prev.length === 0) {
                      return [{ time: timeStr, text, isInterim: true }];
                  }

                  const last = prev[prev.length - 1];
                  
                  // If the last line is interim, we update it
                  if (last.isInterim) {
                      const newHistory = [...prev];
                      // If the new text is just an extension, update it
                      // Otherwise, if it's completely different, we might have missed a commit, so we just replace
                      newHistory[newHistory.length - 1] = { ...last, text };
                      return newHistory;
                  } 
                  
                  // If the last line was stable, we start a new interim line
                  return [...prev, { time: timeStr, text, isInterim: true }];
              });
          };

          const commitTranscriptLine = (text: string) => {
              setLiveTranscript(prev => {
                  const elapsed = Math.floor((Date.now() - recordingStartTime.current) / 1000);
                  const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
                  const seconds = (elapsed % 60).toString().padStart(2, '0');
                  const timeStr = `${minutes}:${seconds}`;

                  // If we have an interim line, we convert it to stable
                  if (prev.length > 0 && prev[prev.length - 1].isInterim) {
                      const newHistory = [...prev];
                      newHistory[newHistory.length - 1] = { time: prev[prev.length - 1].time, text, isInterim: false };
                      return newHistory;
                  }

                  // Otherwise add a new stable line
                  return [...prev, { time: timeStr, text, isInterim: false }];
              });
          };

          sessionRef.current = await sessionPromise;

          workletNode.port.onmessage = (e) => {
              const inputData = e.data;
              
              // Simple Noise Gate: Check if there's significant audio activity
              let hasActivity = false;
              const threshold = 0.01; // Adjust based on environment
              for (let i = 0; i < inputData.length; i++) {
                  if (Math.abs(inputData[i]) > threshold) {
                      hasActivity = true;
                      break;
                  }
              }

              if (!hasActivity) return;

              const pcmData = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) {
                  pcmData[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7FFF;
              }
              
              // Safer base64 conversion for browser
              const uint8 = new Uint8Array(pcmData.buffer);
              let binary = '';
              for (let i = 0; i < uint8.length; i++) {
                  binary += String.fromCharCode(uint8[i]);
              }
              const base64Data = btoa(binary);

              sessionRef.current.sendRealtimeInput({
                  media: { data: base64Data, mimeType: 'audio/pcm;rate=16000' }
              });
          };

      } catch (err: any) {
          console.error("Failed to start live recording:", err);
          setError(`LIVE_RECORDING_ERROR: ${err.message}`);
      }
  };

  const stopLiveRecording = () => {
      if (processorRef.current) {
          processorRef.current.disconnect();
          processorRef.current = null;
      }
      if (audioContextRef.current) {
          audioContextRef.current.close();
          audioContextRef.current = null;
      }
      if (audioStreamRef.current) {
          audioStreamRef.current.getTracks().forEach(track => track.stop());
          audioStreamRef.current = null;
      }
      if (sessionRef.current) {
          sessionRef.current.close();
          sessionRef.current = null;
      }
      setIsRecording(false);

      // Download transcript
      if (liveTranscript.length > 0) {
          const content = liveTranscript.map(t => `[${t.time}] ${t.text}`).join('\n');
          const blob = new Blob([content], { type: 'text/plain' });
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `LIVE_TRANSCRIPT_${Date.now()}.txt`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          window.URL.revokeObjectURL(url);
      }
  };

  const generateReport = async (matchId: string, puuid: string, audioFile?: File, transcriptFile?: File, skipDownload: boolean = false) => {
      // 32MB hard limit for Cloud Run infrastructure
      const MAX_SIZE = 32 * 1024 * 1024; 
      
      if (audioFile && audioFile.size > MAX_SIZE) {
          setError(`FILE_TOO_LARGE: The audio file is ${Math.round(audioFile.size / 1024 / 1024)}MB. The infrastructure limit is 32MB. Please clip the audio to a shorter segment.`);
          return;
      }

      setLoading(true);
      setError('');
      try {
          const formData = new FormData();
          formData.append('matchId', matchId);
          formData.append('puuid', puuid);
          formData.append('region', region);
          if (audioFile) {
              formData.append('audio', audioFile);
          }
          if (transcriptFile) {
              formData.append('transcript', transcriptFile);
          }

          const res = await fetch(`/api/forensics?_t=${Date.now()}`, {
              method: 'POST',
              body: formData,
              cache: 'no-store'
          });
          
          const contentType = res.headers.get("content-type");
          if (!res.ok) {
              let errorMessage = `Forensic generation failed: ${res.status}`;
              if (contentType && contentType.includes("application/json")) {
                  const errorData = await res.json();
                  errorMessage = errorData.error || errorData.message || errorMessage;
              } else {
                  const text = await res.text();
                  console.error("Server returned non-JSON error:", text.substring(0, 100));
              }
              throw new Error(errorMessage);
          }
          
          const { data, report } = await res.json();

          setTelemetry((prev: any) => ({
              ...prev,
              meta: { ...(prev?.meta || {}), timestamp: new Date().toISOString() },
              forensics: {
                  ...data.meta,
                  ...data.stats
              },
              clinical_log: data.telemetryRows,
              tron_stream: data.tronStream,
              toon_match: data.toonMatch,
              winProbabilityTimeline: data.winProbabilityTimeline
          }));
          
          if (!skipDownload) {
              const blob = new Blob([report], { type: 'text/markdown' });
              const url = window.URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `LUNACY_FORENSICS_${matchId}.md`;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              window.URL.revokeObjectURL(url);
          }
      } catch (e: any) {
          console.error(e);
          setError(e.message || "FAILED TO GENERATE REPORT");
      } finally {
          setLoading(false);
      }
  };

  const exportTOON = () => {
      if (!telemetry?.toon_match) return;
      const content = `# LUNACY DATA EXPORT: ${telemetry.forensics.matchId}\n\n## TOON NOTATION\n\`\`\`toon\n${telemetry.toon_match}\n\`\`\``;
      const blob = new Blob([content], { type: 'text/markdown' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `LUNACY_DATA_${telemetry.forensics.matchId}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
  };

  const scanTarget = (e: React.FormEvent) => {
      e.preventDefault();
      performScan(gameName, tagLine);
  };

  const loadMoreMatches = async () => {
      if (loadingMore || scanning || !searchedProfile.name) return;
      
      setLoadingMore(true);
      try {
          const res = await fetch(`/api/matches?_t=${Date.now()}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                  gameName: searchedProfile.name, 
                  tagLine: searchedProfile.tag, 
                  region,
                  start: matches.length,
                  count: 10
              }),
              cache: 'no-store'
          });
          
          if (!res.ok) {
              throw new Error(`Load more failed: ${res.status}`);
          }
          
          const data = await res.json();
          setMatches(prev => [...prev, ...data]);
      } catch (err: any) {
          setError(err.message);
      } finally {
          setLoadingMore(false);
      }
  };

  useEffect(() => {
    fetchTelemetry();
    if (gameName && tagLine) {
        performScan(gameName, tagLine);
    }
  }, []);

  useEffect(() => {
    if (matches.length > 0 && (!telemetry?.forensics?.matchId || telemetry?.forensics?.matchId === 'STANDBY')) {
      const firstMatch = matches[0];
      const participant = firstMatch.info.participants.find((p: any) => 
        p.riotIdGameName?.toLowerCase() === searchedProfile.name.toLowerCase() && 
        p.riotIdTagline?.toLowerCase() === searchedProfile.tag.toLowerCase()
      );
      
      if (participant) {
        generateReport(firstMatch.metadata.matchId, participant.puuid, undefined, undefined, true);
      }
    }
  }, [matches, searchedProfile, region]);

  useEffect(() => {
      let interval: any;
      if (isRecording) {
          interval = setInterval(() => {
              setElapsedTime(Math.floor((Date.now() - recordingStartTime.current) / 1000));
          }, 1000);
      } else {
          setElapsedTime(0);
      }
      return () => clearInterval(interval);
  }, [isRecording]);

  return (
    <div className="min-h-screen bg-void text-signal font-mono selection:bg-signal selection:text-void overflow-hidden flex flex-col">
      {/* CRT Overlays */}
      <div className="crt-lines" />
      <div className="scanline" />

      {/* Header */}
      <header className="border-b border-dim bg-void/80 backdrop-blur-sm z-50 px-6 py-4 flex items-center justify-between sticky top-0">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-signal flex items-center justify-center text-void font-bold text-xs">
            [SYS]
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-[0.2em] glitch-text" data-text="LUNACY_PROTOCOL">
              LUNACY_PROTOCOL
            </h1>
            <div className="flex items-center gap-2 text-[10px] text-dim font-bold">
              <span className="flex items-center gap-1">
                [READY] SYSTEM_SYNC_OK
              </span>
              <span className="opacity-50">|</span>
              <span>FORENSIC_ENGINE_V3.1</span>
            </div>
          </div>
        </div>

        <nav className="hidden md:flex items-center gap-8">
          {[
            { id: 'dashboard', label: 'DASHBOARD', icon: '[DASH]' },
            { id: 'history', label: 'MATCH_HISTORY', icon: '[ARCH]' },
            { id: 'live', label: 'LIVE_SESSION', icon: '[LIVE]' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 text-xs font-bold tracking-widest transition-all hover:text-white ${
                activeTab === tab.id ? 'text-signal border-b-2 border-signal pb-1' : 'text-dim'
              }`}
            >
              <span className="text-[10px] opacity-50">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-4">
          <div className="text-right hidden sm:block">
            <div className="text-[10px] text-dim font-bold uppercase">Operator</div>
            <div className="text-xs font-bold">djnostrom@gmail.com</div>
          </div>
          <div className="w-8 h-8 border border-dim flex items-center justify-center text-[10px] text-dim font-bold">
            [OP]
          </div>
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden relative">
        {/* Sidebar - Controls */}
        <aside className="w-80 border-r border-dim bg-void/50 backdrop-blur-md overflow-y-auto hidden xl:block p-6 space-y-8">
          <section>
            <div className="mb-4">
              {user ? (
                <button onClick={() => signOut(auth)} className="w-full text-[10px] font-bold border border-dim py-2 hover:bg-danger hover:text-white transition-all">
                  SIGN_OUT ({user.email})
                </button>
              ) : (
                <button onClick={() => signInWithPopup(auth, googleProvider)} className="w-full text-[10px] font-bold border border-dim py-2 hover:bg-signal hover:text-void transition-all">
                  SIGN_IN_WITH_GOOGLE
                </button>
              )}
            </div>
            <div className="mb-4">
              <label className="text-[10px] text-dim font-bold">MICROPHONE</label>
              <select 
                value={selectedMicrophoneId}
                onChange={(e) => setSelectedMicrophoneId(e.target.value)}
                className="w-full bg-void border border-dim text-signal p-2 text-xs focus:outline-none focus:border-signal uppercase"
              >
                {availableMicrophones.map(mic => (
                  <option key={mic.deviceId} value={mic.deviceId}>{mic.label || `Microphone ${mic.deviceId.slice(0, 5)}`}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xs font-bold tracking-widest text-dim">[ TARGET_SEARCH ]</h2>
              <span className="text-[10px] text-dim font-bold">[SCAN]</span>
            </div>
            <form onSubmit={scanTarget} className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[10px] text-dim font-bold">REGION</label>
                  <select 
                    value={region}
                    onChange={(e) => setRegion(e.target.value)}
                    className="w-full bg-void border border-dim text-signal p-2 text-xs focus:outline-none focus:border-signal uppercase"
                  >
                    <option value="americas">AMERICAS</option>
                    <option value="asia">ASIA</option>
                    <option value="europe">EUROPE</option>
                    <option value="sea">SEA</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-dim font-bold">TAG</label>
                  <input 
                    type="text" 
                    placeholder="#Snail" 
                    value={tagLine}
                    onChange={(e) => setTagLine(e.target.value)}
                    className="w-full bg-void border border-dim text-signal p-2 text-xs focus:outline-none focus:border-signal uppercase placeholder:text-dim/50"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-dim font-bold">GAME_NAME</label>
                <div className="relative">
                  <input 
                    type="text" 
                    placeholder="Banana Tyrant" 
                    value={gameName}
                    onChange={(e) => setGameName(e.target.value)}
                    className="w-full bg-void border border-dim text-signal p-2 pl-8 text-xs focus:outline-none focus:border-signal uppercase placeholder:text-dim/50"
                  />
                  <span className="absolute left-2 top-2 text-[10px] text-dim font-bold">{" >> "}</span>
                </div>
              </div>
              <button 
                type="submit"
                disabled={scanning || !gameName || !tagLine}
                className="w-full bg-signal text-void font-bold py-3 text-xs tracking-widest hover:bg-white transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {scanning ? 'SCANNING...' : '[INITIATE_SCAN]'}
              </button>
            </form>
          </section>

          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xs font-bold tracking-widest text-dim">[ LIVE_MODULE ]</h2>
              <span className={`text-[10px] font-bold ${isRecording ? 'text-danger animate-pulse' : 'text-dim'}`}>
                {isRecording ? '[REC]' : '[OFF]'}
              </span>
            </div>
            <div className="p-4 border border-dim bg-dim/5 space-y-4">
              <p className="text-[10px] text-dim leading-relaxed uppercase">
                Capture real-time tactical commentary and cognitive state telemetry during active combat.
              </p>
              <button 
                onClick={isRecording ? stopLiveRecording : startLiveRecording}
                className={`w-full font-bold py-3 text-[10px] tracking-widest transition-all border ${
                  isRecording 
                    ? 'bg-danger/20 border-danger text-danger animate-pulse' 
                    : 'bg-signal/10 border-signal text-signal hover:bg-signal hover:text-void'
                }`}
              >
                {isRecording ? 'TERMINATE_SESSION' : 'START_LIVE_CAPTURE'}
              </button>
              {isRecording && (
                <div className="flex items-center justify-between text-[10px] font-bold">
                  <span className="text-danger">REC_ACTIVE</span>
                  <span className="text-dim">{elapsedTime}S</span>
                </div>
              )}
            </div>
          </section>

          <section className="flex-1">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xs font-bold tracking-widest text-dim">[ SYSTEM_LOG ]</h2>
              <span className="text-[10px] text-dim font-bold">[LOG]</span>
            </div>
            <div className="h-48 border border-dim bg-void p-2 overflow-y-auto text-[9px] text-dim space-y-1 font-mono">
              {telemetry?.tron_stream?.slice(-10).map((line: string, i: number) => (
                <div key={i} className="opacity-70 break-all">{line}</div>
              ))}
              {loading && <div className="animate-pulse text-signal">SYNCING_DATA_STREAM...</div>}
              {error && <div className="text-danger">ERROR: {error}</div>}
            </div>
          </section>
        </aside>

        {/* Main Content Area */}
        <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-8 terminal-grid">
          <AnimatePresence mode="wait">
            {activeTab === 'dashboard' && (
              <motion.div 
                key="dashboard"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-8"
              >
                {/* Hero Stats */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  {[
                    { label: 'KDA_RATIO', value: telemetry?.forensics?.kda || '0/0/0', icon: '[KDA]', color: 'text-signal' },
                    { label: 'DMG_SHARE', value: telemetry?.forensics?.damageShare || '0%', icon: '[DMG]', color: 'text-warning' },
                    { label: 'TANK_SHARE', value: telemetry?.forensics?.tankShare || '0%', icon: '[DEF]', color: 'text-blue-400' },
                    { label: 'AGENCY_RATIO', value: telemetry?.forensics?.agencyRatio || '0%', icon: '[AGC]', color: 'text-purple-400' },
                  ].map((stat, i) => (
                    <div key={i} className="bg-void border border-dim p-4 flex items-center gap-4 relative overflow-hidden group">
                      <div className={`w-12 h-12 flex items-center justify-center bg-dim/10 text-[10px] font-bold ${stat.color}`}>
                        {stat.icon}
                      </div>
                      <div>
                        <div className="text-[10px] font-bold text-dim tracking-widest">{stat.label}</div>
                        <div className="text-xl font-bold">{stat.value}</div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* AI Analysis Section */}
                <div className="bg-void border border-dim p-6">
                  <h3 className="text-xs font-bold tracking-widest mb-4 text-signal">[AI_ANALYSIS]</h3>
                  <div className="flex gap-4">
                    <label className="cursor-pointer border border-dim p-2 text-[10px] font-bold hover:bg-signal hover:text-void">
                      UPLOAD_VIDEO_ANALYSIS
                      <input type="file" accept="video/*" className="hidden" onChange={handleVideoUpload} />
                    </label>
                    <label className="cursor-pointer border border-dim p-2 text-[10px] font-bold hover:bg-signal hover:text-void">
                      UPLOAD_AUDIO_TRANSCRIPTION
                      <input type="file" accept="audio/*" className="hidden" onChange={handleAudioUpload} />
                    </label>
                  </div>
                  {analysisResult && (
                    <div className="mt-4 p-4 border border-dim text-xs text-dim font-mono">
                      {analysisResult}
                    </div>
                  )}
                </div>

                {/* Charts Section */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <div className="lg:col-span-2 bg-void border border-dim p-6 space-y-6">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-bold tracking-widest flex items-center gap-2">
                        <span className="text-signal">[CHART]</span>
                        WIN_PROBABILITY_TIMELINE
                      </h3>
                      <div className="text-[10px] text-dim font-bold">UNIT: PERCENTAGE (%)</div>
                    </div>
                    <div className="h-[300px] w-full">
                      {activeTab === 'dashboard' && (
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={winProbData}>
                            <defs>
                              <linearGradient id="colorProb" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#28f06b" stopOpacity={0.3}/>
                                <stop offset="95%" stopColor="#28f06b" stopOpacity={0}/>
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#1a4d2e" vertical={false} />
                            <XAxis 
                              dataKey="minute" 
                              stroke="#1a4d2e" 
                              fontSize={10} 
                              tickFormatter={(val) => `T+${val}`}
                            />
                            <YAxis 
                              stroke="#1a4d2e" 
                              fontSize={10} 
                              domain={[0, 100]}
                              tickFormatter={(val) => `${val}%`}
                            />
                            <Tooltip 
                              contentStyle={{ backgroundColor: '#000', border: '1px solid #1a4d2e', fontSize: '10px' }}
                              itemStyle={{ color: '#28f06b' }}
                              labelFormatter={(val) => `MINUTE: ${val}`}
                            />
                            <Area 
                              type="monotone" 
                              dataKey="probability" 
                              stroke="#28f06b" 
                              fillOpacity={1} 
                              fill="url(#colorProb)" 
                              strokeWidth={2}
                              animationDuration={1500}
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  </div>

                  <div className="bg-void border border-dim p-6 flex flex-col">
                    <h3 className="text-xs font-bold tracking-widest mb-6 flex items-center gap-2">
                      <span className="text-signal">[METR]</span>
                      COMPARATIVE_IMPACT
                    </h3>
                    <div className="h-[250px] w-full">
                      {activeTab === 'dashboard' && (
                        <ResponsiveContainer width="100%" height="100%">
                          <RadarChart cx="50%" cy="50%" outerRadius="80%" data={comparativeData}>
                            <PolarGrid stroke="#1a4d2e" />
                            <PolarAngleAxis dataKey="subject" tick={{ fill: '#8E9299', fontSize: 10 }} />
                            <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                            <Radar
                              name="Impact"
                              dataKey="A"
                              stroke="#28f06b"
                              fill="#28f06b"
                              fillOpacity={0.3}
                            />
                          </RadarChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  </div>
                </div>

                {/* Detailed Telemetry Table */}
                <div className="bg-void border border-dim overflow-hidden">
                  <div className="p-4 border-b border-dim flex items-center justify-between bg-dim/5">
                    <h3 className="text-xs font-bold tracking-widest flex items-center gap-2">
                      <span className="text-signal">[DATA]</span>
                      TACTICAL_TELEMETRY_LOG
                    </h3>
                    {telemetry?.toon_match && (
                      <button 
                        onClick={exportTOON}
                        className="text-[10px] font-bold text-signal hover:text-white flex items-center gap-1"
                      >
                        [EXPORT_TOON]
                      </button>
                    )}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-[10px] border-collapse">
                      <thead>
                        <tr className="border-b border-dim text-dim uppercase">
                          <th className="p-3 font-bold">TIME</th>
                          <th className="p-3 font-bold">EVENT</th>
                          <th className="p-3 font-bold">LOCATION</th>
                          <th className="p-3 font-bold">OUTCOME</th>
                          <th className="p-3 font-bold">PHASE</th>
                          <th className="p-3 font-bold text-right">WIN_PROB</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-dim/30">
                        {telemetry?.clinical_log?.slice(0, 20).map((row: any, i: number) => (
                          <tr key={i} className="hover:bg-signal/5 transition-colors group">
                            <td className="p-3 font-bold text-dim group-hover:text-signal">{row.preciseTime}</td>
                            <td className="p-3 font-bold">{row.eventName}</td>
                            <td className="p-3 text-dim">{row.context}</td>
                            <td className="p-3">
                              <span className={`px-1 py-0.5 ${
                                row.outcome === 'ADVANTAGE' ? 'bg-signal/20 text-signal' : 
                                row.outcome === 'DEFICIT' ? 'bg-danger/20 text-danger' : 'text-dim'
                              }`}>
                                {row.outcome}
                              </span>
                            </td>
                            <td className="p-3 text-dim">{row.zone}</td>
                            <td className="p-3 text-right font-bold text-signal">{row.winProb}</td>
                          </tr>
                        ))}
                        {(!telemetry?.clinical_log || telemetry.clinical_log.length === 0) && (
                          <tr>
                            <td colSpan={6} className="p-12 text-center text-dim italic uppercase tracking-widest">
                              Awaiting forensic data input...
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'history' && (
              <motion.div 
                key="history"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                <div className="flex items-center justify-between mb-8">
                  <h2 className="text-xl font-bold tracking-widest flex items-center gap-3">
                    <span className="text-signal">[ARCHIVE]</span>
                    MATCH_ARCHIVE
                  </h2>
                  <div className="flex items-center gap-4">
                    <div className="relative">
                      <input 
                        type="text" 
                        placeholder="FILTER_CHAMPION..." 
                        value={championFilter}
                        onChange={(e) => setChampionFilter(e.target.value)}
                        className="bg-void border border-dim text-signal p-2 pl-8 text-[10px] focus:outline-none focus:border-signal uppercase w-48"
                      />
                      <span className="absolute left-2 top-2.5 text-[10px] text-dim font-bold">{" >> "}</span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {matches
                    .filter((match: any) => {
                      if (!championFilter) return true;
                      const participant = match.info.participants.find((p: any) => 
                        p.riotIdGameName?.toLowerCase() === searchedProfile.name.toLowerCase() && 
                        p.riotIdTagline?.toLowerCase() === searchedProfile.tag.toLowerCase()
                      );
                      return participant?.championName.toLowerCase().includes(championFilter.toLowerCase());
                    })
                    .map((match: any) => {
                      const participant = match.info.participants.find((p: any) => 
                        p.riotIdGameName?.toLowerCase() === searchedProfile.name.toLowerCase() && 
                        p.riotIdTagline?.toLowerCase() === searchedProfile.tag.toLowerCase()
                      );
                      
                      if (!participant) return null;
                      const win = participant.win;
                      
                      return (
                        <motion.div 
                          layout
                          key={match.metadata.matchId} 
                          className={`border border-dim bg-void p-5 flex flex-col gap-4 relative group hover:border-signal transition-all ${
                            win ? 'border-l-4 border-l-signal' : 'border-l-4 border-l-danger'
                          }`}
                        >
                          <div className="flex justify-between items-start">
                            <div className="flex items-center gap-4">
                              <div className="w-12 h-12 bg-dim/20 flex items-center justify-center relative overflow-hidden">
                                <img 
                                  src={`https://ddragon.leagueoflegends.com/cdn/14.5.1/img/champion/${participant.championName}.png`}
                                  alt={participant.championName}
                                  className="w-full h-full object-cover terminal-tint grayscale group-hover:grayscale-0 transition-all"
                                  referrerPolicy="no-referrer"
                                />
                                <div className={`absolute -bottom-1 -right-1 w-4 h-4 flex items-center justify-center text-[8px] font-bold ${win ? 'bg-signal text-void' : 'bg-danger text-white'}`}>
                                  {win ? 'W' : 'L'}
                                </div>
                              </div>
                              <div>
                                <h4 className="font-bold text-lg leading-none mb-1">{participant.championName}</h4>
                                <div className="text-[10px] text-dim font-bold uppercase flex items-center gap-2">
                                  [DATE] {new Date(match.info.gameCreation).toLocaleDateString()}
                                </div>
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-xl font-bold tracking-tighter">{participant.kills}/{participant.deaths}/{participant.assists}</div>
                              <div className="text-[10px] text-dim font-bold uppercase">KDA_PERFORMANCE</div>
                            </div>
                          </div>

                          <div className="grid grid-cols-3 gap-2 text-[9px] font-bold uppercase text-dim">
                            <div className="bg-dim/5 p-2 border border-dim/20">
                              <div>CS_TOTAL</div>
                              <div className="text-signal">{participant.totalMinionsKilled + participant.neutralMinionsKilled}</div>
                            </div>
                            <div className="bg-dim/5 p-2 border border-dim/20">
                              <div>GOLD_EARNED</div>
                              <div className="text-signal">{participant.goldEarned.toLocaleString()}</div>
                            </div>
                            <div className="bg-dim/5 p-2 border border-dim/20">
                              <div>DMG_DEALT</div>
                              <div className="text-signal">{participant.totalDamageDealtToChampions.toLocaleString()}</div>
                            </div>
                          </div>

                          <div className="flex gap-2 mt-2">
                            <button 
                              onClick={() => triggerUpload(match.metadata.matchId, participant.puuid)}
                              className="flex-1 text-[9px] font-bold border border-dim py-2 hover:bg-signal hover:text-void transition-all flex items-center justify-center gap-1"
                            >
                              [UPLOAD_AUDIO]
                            </button>
                            <button 
                              onClick={() => generateReport(match.metadata.matchId, participant.puuid)}
                              className="flex-1 text-[9px] font-bold bg-signal text-void py-2 hover:bg-white transition-all flex items-center justify-center gap-1"
                            >
                              [GENERATE_FORENSICS]
                            </button>
                          </div>

                          <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity text-signal">
                            {" >> "}
                          </div>
                        </motion.div>
                      )
                    })}
                  {matches.length === 0 && (
                    <div className="col-span-full p-20 border border-dashed border-dim flex flex-col items-center justify-center text-dim space-y-4">
                      <span className="text-4xl opacity-20">[?]</span>
                      <p className="text-xs font-bold tracking-[0.3em] uppercase">No match data found in archive</p>
                    </div>
                  )}
                </div>

                {matches.length > 0 && (
                  <div className="flex justify-center mt-8">
                    <button 
                      onClick={loadMoreMatches}
                      disabled={loadingMore}
                      className={`px-8 py-3 border border-dim text-[10px] font-bold tracking-widest uppercase transition-all hover:bg-signal hover:text-void flex items-center gap-2 ${loadingMore ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      {loadingMore ? (
                        <>
                          <RefreshCw className="w-3 h-3 animate-spin" />
                          FETCHING_MORE_DATA...
                        </>
                      ) : (
                        '[ LOAD_MORE_MATCHES ]'
                      )}
                    </button>
                  </div>
                )}
              </motion.div>
            )}

            {activeTab === 'live' && (
              <motion.div 
                key="live"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="max-w-4xl mx-auto space-y-8"
              >
                <div className="text-center space-y-4">
                  <div className="inline-flex items-center gap-2 px-4 py-1 border border-dim bg-dim/5 rounded-full">
                    <div className={`w-2 h-2 rounded-full ${isRecording ? 'bg-danger animate-pulse' : 'bg-dim'}`} />
                    <span className="text-[10px] font-bold tracking-widest text-dim uppercase">
                      {isRecording ? 'LIVE_TRANSMISSION_ACTIVE' : 'SYSTEM_STANDBY'}
                    </span>
                  </div>
                  <h2 className="text-3xl font-bold tracking-widest uppercase">Tactical Voice Capture</h2>
                  <p className="text-xs text-dim max-w-lg mx-auto leading-relaxed uppercase">
                    Sync your cognitive state with game telemetry in real-time. The engine analyzes your callouts and emotional spikes to map mechanics to mindset.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="bg-void border border-dim p-8 flex flex-col items-center justify-center space-y-8 relative overflow-hidden">
                    <div className="absolute inset-0 opacity-5 pointer-events-none">
                      <div className="w-full h-full terminal-grid" />
                    </div>
                    
                    <div className="relative">
                      <motion.div 
                        animate={isRecording ? { scale: [1, 1.1, 1] } : {}}
                        transition={{ repeat: Infinity, duration: 2 }}
                        className={`w-32 h-32 rounded-full border-2 flex items-center justify-center transition-colors ${
                          isRecording ? 'border-danger text-danger shadow-[0_0_30px_rgba(255,68,68,0.2)]' : 'border-dim text-dim'
                        }`}
                      >
                        <span className="text-2xl font-bold">{isRecording ? '[REC]' : '[OFF]'}</span>
                      </motion.div>
                      {isRecording && (
                        <div className="absolute -top-2 -right-2 bg-danger text-white text-[8px] font-bold px-2 py-1">
                          LIVE
                        </div>
                      )}
                    </div>

                    <div className="w-full space-y-2">
                      <div className="flex justify-between text-[10px] font-bold text-dim mb-1">
                        <span>SIGNAL_STRENGTH</span>
                        <span>{Math.round((audioLevel / 128) * 100)}%</span>
                      </div>
                      <div className="h-2 bg-dim/20 w-full flex gap-0.5">
                        {Array.from({ length: 20 }).map((_, i) => (
                          <div 
                            key={i} 
                            className={`flex-1 h-full transition-all duration-75 ${
                              (audioLevel / 128) * 20 > i ? 'bg-signal' : 'bg-dim/20'
                            }`}
                          />
                        ))}
                      </div>
                    </div>

                    <button 
                      onClick={isRecording ? stopLiveRecording : startLiveRecording}
                      className={`w-full py-4 font-bold tracking-[0.2em] transition-all ${
                        isRecording 
                          ? 'bg-danger text-white hover:bg-white hover:text-danger' 
                          : 'bg-signal text-void hover:bg-white'
                      }`}
                    >
                      {isRecording ? 'TERMINATE_CAPTURE' : 'INITIALIZE_CAPTURE'}
                    </button>
                  </div>

                  <div className="bg-void border border-dim flex flex-col h-[400px]">
                    <div className="p-4 border-b border-dim bg-dim/5 flex items-center justify-between">
                      <span className="text-[10px] font-bold tracking-widest text-dim uppercase">Live_Transcript_Stream</span>
                      <span className="text-[10px] text-dim font-bold">[LOG]</span>
                    </div>
                    <div className="flex-1 p-4 overflow-y-auto font-mono text-xs space-y-4">
                      {liveTranscript.length === 0 && (
                        <div className="h-full flex flex-col items-center justify-center text-dim/30 space-y-2">
                          <span className="text-2xl">[?]</span>
                          <span className="text-[10px] font-bold uppercase">Awaiting signal input...</span>
                        </div>
                      )}
                      {liveTranscript.map((t, i) => (
                        <div key={i} className={`flex gap-3 ${t.isInterim ? 'opacity-40 italic' : ''}`}>
                          <span className="text-dim font-bold">[{t.time}]</span>
                          <span className="flex-1">{t.text}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* Footer / Status Bar */}
      <footer className="border-t border-dim bg-void px-4 py-2 flex items-center justify-between text-[9px] font-bold text-dim z-50">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-signal animate-pulse" />
            <span>CORE_SYNC: STABLE</span>
          </div>
          <div className="hidden sm:flex items-center gap-2">
            <span>[TIME] {new Date().toLocaleTimeString()}</span>
          </div>
          <div className="hidden md:flex items-center gap-2 uppercase">
            <span>Region: {region}</span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span>LATENCY: 24MS</span>
          <span className="text-signal">ENCRYPTED_LINK_ACTIVE</span>
        </div>
      </footer>

      {/* Hidden Inputs */}
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleFileSelect} 
        accept="audio/*" 
        className="hidden" 
      />
      <input 
        type="file" 
        ref={transcriptInputRef} 
        onChange={handleTranscriptSelect} 
        accept=".txt,.md" 
        className="hidden" 
      />
    </div>
  );
}

export default App;
