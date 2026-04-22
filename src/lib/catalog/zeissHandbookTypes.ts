export type ZeissHandbookSection = {
  id: string;
  labelZh: string;
  labelEn: string;
  /** 在 flipbook 中的 0-based 页码 */
  startPage: number;
};

export type ZeissHandbookPage = {
  sectionId: string;
  title: string;
  subtitle?: string;
  /** 同源绝对路径，扫描模式下每页必有 */
  imageUrl?: string | null;
};

export type ZeissHandbookManifest = {
  title: string;
  /** 单页宽高比 W:H（如成长乐竖版 3:4），用于计算 flipbook 尺寸，避免拉伸 */
  pageAspect?: { w: number; h: number };
  sections: ZeissHandbookSection[];
  pages: ZeissHandbookPage[];
};
