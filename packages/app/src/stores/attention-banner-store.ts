import { create } from "zustand";

export interface AttentionBannerPayload {
  title: string;
  body?: string;
  data?: Record<string, unknown>;
}

export interface AttentionBannerState {
  banner: (AttentionBannerPayload & { id: number; extraCount: number }) | null;
  /** Read-only snapshot shown in the peek sheet; lives here so any banner surface can open it. */
  peeked: { title: string; body?: string } | null;
  show: (payload: AttentionBannerPayload) => void;
  dismiss: () => void;
  peek: () => void;
  closePeek: () => void;
}

let nextId = 1;

export const useAttentionBannerStore = create<AttentionBannerState>((set, get) => ({
  banner: null,
  peeked: null,
  show: (payload) => {
    const current = get().banner;
    set({
      banner: {
        id: nextId++,
        title: payload.title,
        body: payload.body,
        data: payload.data,
        // If a banner was already showing, count how many earlier ones were replaced.
        extraCount: current ? current.extraCount + 1 : 0,
      },
    });
  },
  dismiss: () => set({ banner: null }),
  peek: () => {
    const banner = get().banner;
    if (banner) {
      set({ peeked: { title: banner.title, body: banner.body } });
    }
  },
  closePeek: () => set({ peeked: null }),
}));
