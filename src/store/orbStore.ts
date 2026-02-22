import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface OrbStoreState {
  autoRotate: boolean;
  postProcessingEnabled: boolean;
  bloomIntensity: number;
  setAutoRotate: (v: boolean) => void;
  setPostProcessingEnabled: (v: boolean) => void;
  setBloomIntensity: (v: number) => void;
  togglePostProcessing: () => void;
}

export const useOrbStore = create<OrbStoreState>()(
  persist(
    (set) => ({
      autoRotate: true,
      postProcessingEnabled: true,
      bloomIntensity: 1.5,
      setAutoRotate: (v) => set({ autoRotate: v }),
      setPostProcessingEnabled: (v) => set({ postProcessingEnabled: v }),
      setBloomIntensity: (v) => set({ bloomIntensity: v }),
      togglePostProcessing: () => set(s => ({ postProcessingEnabled: !s.postProcessingEnabled })),
    }),
    { name: 'vanna:orb' }
  )
);
