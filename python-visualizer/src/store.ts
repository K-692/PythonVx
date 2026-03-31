import { create } from 'zustand';

export interface Scope {
  [variableName: string]: string;
}

export interface StackFrame {
  name: string;
  scope: Scope;
}

export interface TimelineStep {
  step: number;
  line: number;
  code: string;
  stack: StackFrame[];
  stdout: string;
  event: 'line' | 'return' | 'exception' | 'error';
  error?: string;
  return_data?: { function: string, value: string };
  chain_returns?: { line: number, col: number, method: string, value: string }[];
}

export interface Token {
  type: 'variable' | 'syntax';
  value: string;
  startCol: number;
  endCol: number;
}

export interface LineModel {
  line: number;
  text: string;
  tokens: Token[];
  indentCols?: number;
}

export interface FunctionModel {
  name: string;
  args: string[];
  startLine: number;
  endLine: number;
}

export interface ClassModel {
  name: string;
  bases: string[];
  startLine: number;
  endLine: number;
}

export interface AssignmentModel {
  startLine: number;
  endLine: number;
}

export interface Scaffold {
  classes: ClassModel[];
  functions: FunctionModel[];
  lines: LineModel[];
  assignments?: AssignmentModel[];
}

interface AppState {
  code: string;
  setCode: (code: string) => void;

  timeline: TimelineStep[];
  setTimeline: (timeline: TimelineStep[]) => void;

  scaffold: Scaffold | null;
  setScaffold: (scaffold: Scaffold) => void;

  currentStepIndex: number;
  setCurrentStepIndex: (index: number) => void;
  nextStep: () => void;
  prevStep: () => void;
  reset: () => void;

  isPlaying: boolean;
  setIsPlaying: (isPlaying: boolean) => void;

  playbackSpeed: number;
  setPlaybackSpeed: (speed: number) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  code: `print("Hello World")`,
  setCode: (code) => set({ code }),

  timeline: [],
  setTimeline: (timeline) => set({ timeline, currentStepIndex: 0, isPlaying: true }),

  scaffold: null,
  setScaffold: (scaffold) => set({ scaffold }),

  currentStepIndex: 0,
  setCurrentStepIndex: (index) => set({ currentStepIndex: index }),

  nextStep: () => {
    const { currentStepIndex, timeline, isPlaying } = get();
    if (timeline.length === 0) return;
    
    if (currentStepIndex < timeline.length - 1) {
      set({ currentStepIndex: currentStepIndex + 1 });
    } else if (isPlaying) {
      // Loop seamlessly
      set({ currentStepIndex: 0 });
    }
  },

  prevStep: () => {
    const { currentStepIndex } = get();
    if (currentStepIndex > 0) {
      set({ currentStepIndex: currentStepIndex - 1, isPlaying: false });
    }
  },

  reset: () => {
    set({ currentStepIndex: 0, isPlaying: false });
  },

  isPlaying: false,
  setIsPlaying: (isPlaying) => set({ isPlaying }),

  playbackSpeed: 2000, // Default to 0.1x (2000ms) for slower initial study pace
  setPlaybackSpeed: (speed) => set({ playbackSpeed: speed }),
}));
