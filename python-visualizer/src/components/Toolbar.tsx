import { useAppStore } from '../store';
import {
  IconPlayerPlay,
  IconPlayerPause,
  IconPlayerTrackNext,
  IconPlayerTrackPrev,
  IconRefresh,
  IconBrandGithub
} from '@tabler/icons-react';
import { useEffect } from 'react';

// No invoke import needed anymore here
export function Toolbar() {
  const {
    timeline,
    currentStepIndex,
    isPlaying,
    setIsPlaying,
    nextStep,
    prevStep,
    reset,
    playbackSpeed,
    setPlaybackSpeed,
  } = useAppStore();

  // Replaced manual run with auto-run logic in the Editor

  const togglePlay = () => {
    if (timeline.length === 0) return;
    setIsPlaying(!isPlaying);
  };

  useEffect(() => {
    let interval: number;
    if (isPlaying) {
      interval = setInterval(() => {
        nextStep();
      }, playbackSpeed);
    }
    return () => clearInterval(interval);
  }, [isPlaying, playbackSpeed, nextStep]);

  return (
    <header className="toolbar">
      <div className="toolbar-brand" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontWeight: 600 }}>PythonVx</span>
        <a 
          href="https://github.com/K-692/PythonVx.git" 
          target="_blank" 
          rel="noopener noreferrer"
          className="github-link"
          style={{ 
            color: 'var(--text-muted)', 
            display: 'flex', 
            alignItems: 'center',
            transition: 'color 0.2s ease',
            textDecoration: 'none'
          }}
          onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
          onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
        >
          <IconBrandGithub size={20} />
        </a>
      </div>

      <div className="toolbar-actions">
        {timeline.length > 0 && (
          <>
            <button className="btn" onClick={() => { setIsPlaying(false); prevStep(); }} disabled={currentStepIndex === 0}>
              <IconPlayerTrackPrev size={18} />
              Undo
            </button>

            <button className="btn btn-primary" onClick={togglePlay}>
              {isPlaying ? <IconPlayerPause size={18} /> : <IconPlayerPlay size={18} />}
              {isPlaying ? 'Pause' : 'Play'}
            </button>

            <button className="btn" onClick={() => { setIsPlaying(false); nextStep(); }} disabled={currentStepIndex === timeline.length - 1}>
              <IconPlayerTrackNext size={18} />
              Step
            </button>

            <button className="btn" onClick={reset}>
              <IconRefresh size={18} />
              Reset
            </button>

            <div className="slider-container" style={{ marginLeft: 16, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                className="btn"
                onClick={() => setPlaybackSpeed(Math.min(2000, playbackSpeed + 100))}
                title="Slower"
                style={{ padding: '2px 8px', minWidth: 'auto', fontSize: '1.2rem', background: 'transparent', border: 'none' }}
              >
                -
              </button>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}>
                <span style={{ fontSize: '0.65rem', color: 'var(--accent-primary)', position: 'absolute', top: '-24px', zIndex: 1, fontWeight: 'bold' }}>
                  {((2100 - playbackSpeed) / 1000).toFixed(1)}x
                </span>
                <input
                  type="range"
                  className="playback-slider"
                  min="100"
                  max="2000"
                  step="100"
                  value={2100 - playbackSpeed} // Inverse scale for UX (right = faster)
                  onChange={(e) => setPlaybackSpeed(2100 - parseInt(e.target.value))}
                />
              </div>
              <button
                className="btn"
                onClick={() => setPlaybackSpeed(Math.max(100, playbackSpeed - 100))}
                title="Faster"
                style={{ padding: '2px 8px', minWidth: 'auto', fontSize: '1.2rem', background: 'transparent', border: 'none' }}
              >
                +
              </button>
            </div>
          </>
        )}

      </div>
    </header>
  );
}
