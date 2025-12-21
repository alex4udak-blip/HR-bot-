import { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { X, Upload, Video, Phone, Link as LinkIcon, User } from 'lucide-react';
import clsx from 'clsx';
import { useCallStore } from '@/stores/callStore';
import { getEntities } from '@/services/api';
import type { Entity } from '@/types';

interface CallRecorderModalProps {
  onClose: () => void;
  onSuccess: (callId: number) => void;
}

type RecordMode = 'upload' | 'bot';

export default function CallRecorderModal({ onClose, onSuccess }: CallRecorderModalProps) {
  const { uploadCall, startBot, loading } = useCallStore();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<RecordMode>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [meetingUrl, setMeetingUrl] = useState('');
  const [botName, setBotName] = useState('HR Recorder');
  const [selectedEntityId, setSelectedEntityId] = useState<number | null>(null);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [searchEntity, setSearchEntity] = useState('');
  const [showEntityDropdown, setShowEntityDropdown] = useState(false);

  useEffect(() => {
    loadEntities();
  }, []);

  const loadEntities = async () => {
    try {
      const data = await getEntities({ limit: 100 });
      setEntities(data);
    } catch (err) {
      console.error('Failed to load entities:', err);
    }
  };

  const filteredEntities = entities.filter((e) =>
    e.name.toLowerCase().includes(searchEntity.toLowerCase())
  );

  const selectedEntity = entities.find((e) => e.id === selectedEntityId);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) {
      setFile(selected);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const dropped = e.dataTransfer.files[0];
    if (dropped) {
      setFile(dropped);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      let callId: number;

      if (mode === 'upload') {
        if (!file) return;
        callId = await uploadCall(file, selectedEntityId || undefined);
      } else {
        if (!meetingUrl) return;
        callId = await startBot(meetingUrl, botName, selectedEntityId || undefined);
      }

      onSuccess(callId);
    } catch (err) {
      // Error is handled by store
    }
  };

  const isValidUrl = (url: string) => {
    return url.includes('meet.google.com') || url.includes('zoom.us');
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-gray-900 rounded-2xl w-full max-w-lg border border-white/10 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-white/10">
          <h2 className="text-xl font-semibold text-white">New Recording</h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-white/10 transition-colors"
          >
            <X size={20} className="text-white/60" />
          </button>
        </div>

        {/* Mode Tabs */}
        <div className="flex p-4 gap-2 border-b border-white/10">
          <button
            onClick={() => setMode('upload')}
            className={clsx(
              'flex-1 p-3 rounded-lg flex items-center justify-center gap-2 transition-colors',
              mode === 'upload'
                ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/50'
                : 'bg-white/5 text-white/60 border border-white/10 hover:bg-white/10'
            )}
          >
            <Upload size={20} />
            Upload File
          </button>
          <button
            onClick={() => setMode('bot')}
            className={clsx(
              'flex-1 p-3 rounded-lg flex items-center justify-center gap-2 transition-colors',
              mode === 'bot'
                ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/50'
                : 'bg-white/5 text-white/60 border border-white/10 hover:bg-white/10'
            )}
          >
            <Video size={20} />
            Join Meeting
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {mode === 'upload' ? (
            <>
              {/* File Upload */}
              <div
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                onClick={() => fileInputRef.current?.click()}
                className={clsx(
                  'border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors',
                  file
                    ? 'border-cyan-500/50 bg-cyan-500/10'
                    : 'border-white/20 hover:border-white/40'
                )}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="audio/*,video/*,.mp3,.mp4,.wav,.m4a,.webm,.ogg"
                  onChange={handleFileChange}
                  className="hidden"
                />
                {file ? (
                  <div className="flex flex-col items-center">
                    <Upload size={40} className="text-cyan-400 mb-3" />
                    <p className="text-white font-medium">{file.name}</p>
                    <p className="text-sm text-white/40 mt-1">
                      {(file.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center">
                    <Upload size={40} className="text-white/40 mb-3" />
                    <p className="text-white/60">Drop audio/video file here</p>
                    <p className="text-sm text-white/40 mt-1">
                      or click to browse
                    </p>
                    <p className="text-xs text-white/30 mt-3">
                      MP3, MP4, WAV, M4A, WebM, OGG
                    </p>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              {/* Meeting URL */}
              <div>
                <label className="block text-sm font-medium text-white/60 mb-2">
                  Meeting URL
                </label>
                <div className="relative">
                  <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" size={18} />
                  <input
                    type="url"
                    value={meetingUrl}
                    onChange={(e) => setMeetingUrl(e.target.value)}
                    className={clsx(
                      'w-full pl-10 pr-4 py-2 bg-white/5 border rounded-lg text-white placeholder-white/40 focus:outline-none',
                      meetingUrl && !isValidUrl(meetingUrl)
                        ? 'border-red-500/50 focus:border-red-500/50'
                        : 'border-white/10 focus:border-cyan-500/50'
                    )}
                    placeholder="https://meet.google.com/xxx-xxxx-xxx"
                  />
                </div>
                {meetingUrl && !isValidUrl(meetingUrl) && (
                  <p className="text-red-400 text-xs mt-1">
                    Only Google Meet and Zoom are supported
                  </p>
                )}
              </div>

              {/* Bot Name */}
              <div>
                <label className="block text-sm font-medium text-white/60 mb-2">
                  Bot Display Name
                </label>
                <input
                  type="text"
                  value={botName}
                  onChange={(e) => setBotName(e.target.value)}
                  className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-cyan-500/50"
                  placeholder="HR Recorder"
                />
              </div>
            </>
          )}

          {/* Link to Entity */}
          <div className="relative">
            <label className="block text-sm font-medium text-white/60 mb-2">
              Link to Contact (optional)
            </label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" size={18} />
              <input
                type="text"
                value={selectedEntity ? selectedEntity.name : searchEntity}
                onChange={(e) => {
                  setSearchEntity(e.target.value);
                  setSelectedEntityId(null);
                  setShowEntityDropdown(true);
                }}
                onFocus={() => setShowEntityDropdown(true)}
                className="w-full pl-10 pr-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-cyan-500/50"
                placeholder="Search contacts..."
              />
              {selectedEntityId && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedEntityId(null);
                    setSearchEntity('');
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/60"
                >
                  <X size={16} />
                </button>
              )}
            </div>

            {/* Entity Dropdown */}
            {showEntityDropdown && !selectedEntityId && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="absolute z-10 w-full mt-1 bg-gray-800 border border-white/10 rounded-lg shadow-lg max-h-48 overflow-y-auto"
              >
                {filteredEntities.length > 0 ? (
                  filteredEntities.slice(0, 10).map((entity) => (
                    <button
                      key={entity.id}
                      type="button"
                      onClick={() => {
                        setSelectedEntityId(entity.id);
                        setSearchEntity('');
                        setShowEntityDropdown(false);
                      }}
                      className="w-full px-4 py-2 text-left hover:bg-white/10 transition-colors flex items-center gap-3"
                    >
                      <User size={16} className="text-white/40" />
                      <div>
                        <p className="text-white text-sm">{entity.name}</p>
                        <p className="text-xs text-white/40">{entity.type}</p>
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="px-4 py-3 text-white/40 text-sm">No contacts found</div>
                )}
              </motion.div>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-white/5 text-white/60 rounded-lg hover:bg-white/10 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || (mode === 'upload' ? !file : !meetingUrl || !isValidUrl(meetingUrl))}
              className="flex-1 px-4 py-2 bg-cyan-500 text-white rounded-lg hover:bg-cyan-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading && (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              )}
              {mode === 'upload' ? 'Upload & Process' : 'Start Recording'}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}
