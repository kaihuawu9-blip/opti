/** 蔡司/豪雅手册：由 ZeissDigitalHandbook 挂载 StPageFlip 引擎，供 ZeissSeriesNavList 物理条点击调 flip */
export {};

declare global {
  interface Window {
    pageFlipInstance?: {
      flip: (page: number, corner?: 'top' | 'bottom' | string) => void;
      getCurrentPageIndex?: () => number;
    };
  }
}
