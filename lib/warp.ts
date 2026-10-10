import type { Rect } from "./db";

// 写真の台形補正（ななめに撮った答案をまっすぐにする）と、解答欄の切り出し。
// すべてブラウザ内で処理し、外部には送らない。

export type Point = { x: number; y: number };
/** 用紙の四隅（左上・右上・右下・左下）。元画像に対する0〜1の割合 */
export type Quad = [Point, Point, Point, Point];

export const TEMPLATE_WIDTH = 1200;
const SOURCE_MAX_EDGE = 2400;

export const defaultQuad = (): Quad => [
  { x: 0.03, y: 0.03 },
  { x: 0.97, y: 0.03 },
  { x: 0.97, y: 0.97 },
  { x: 0.03, y: 0.97 },
];

export type SourceImage = { canvas: HTMLCanvasElement; url: string };

/** 撮影した写真を読み込む（大きすぎる場合は縮小） */
export const loadSource = (file: Blob) =>
  new Promise<SourceImage>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, SOURCE_MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve({ canvas, url });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("画像を読み込めませんでした"));
    };
    img.src = url;
  });

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** 四隅の位置から、補正後の用紙の高さ（幅1200px基準）を推定する */
export const estimateHeight = (quad: Quad, srcW: number, srcH: number) => {
  const px = quad.map((p) => ({ x: p.x * srcW, y: p.y * srcH }));
  const width = (dist(px[0], px[1]) + dist(px[3], px[2])) / 2;
  const height = (dist(px[0], px[3]) + dist(px[1], px[2])) / 2;
  return Math.round((TEMPLATE_WIDTH * height) / width);
};

/** 8元連立方程式を解いて、出力の長方形 → 元画像の四角形 への射影変換行列を求める */
const homography = (dst: Point[], src: Point[]) => {
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = dst[i];
    const { x: u, y: v } = src[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let c = 0; c < 8; c++) {
    let pivot = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[pivot][c])) pivot = r;
    [A[c], A[pivot]] = [A[pivot], A[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k];
    }
  }
  const h = A.map((row, i) => row[8] / row[i]);
  return [...h, 1];
};

/** 元画像の四角形の範囲を、width×height の長方形にまっすぐ引き伸ばす */
export const warp = (source: HTMLCanvasElement, quad: Quad, width: number, height: number) => {
  const sw = source.width;
  const sh = source.height;
  const src = source.getContext("2d")!.getImageData(0, 0, sw, sh).data;
  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const ctx = out.getContext("2d")!;
  const outData = ctx.createImageData(width, height);
  const d = outData.data;

  const h = homography(
    [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: height },
      { x: 0, y: height },
    ],
    quad.map((p) => ({ x: p.x * sw, y: p.y * sh })),
  );

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const w = h[6] * x + h[7] * y + h[8];
      const u = (h[0] * x + h[1] * y + h[2]) / w;
      const v = (h[3] * x + h[4] * y + h[5]) / w;
      const o = (y * width + x) * 4;
      if (u < 0 || v < 0 || u >= sw - 1 || v >= sh - 1) {
        d[o] = d[o + 1] = d[o + 2] = 255;
        d[o + 3] = 255;
        continue;
      }
      // バイリニア補間（手書きの線をなめらかに保つ）
      const x0 = Math.floor(u);
      const y0 = Math.floor(v);
      const fx = u - x0;
      const fy = v - y0;
      const i00 = (y0 * sw + x0) * 4;
      const i10 = i00 + 4;
      const i01 = i00 + sw * 4;
      const i11 = i01 + 4;
      for (let c = 0; c < 3; c++) {
        const top = src[i00 + c] * (1 - fx) + src[i10 + c] * fx;
        const bottom = src[i01 + c] * (1 - fx) + src[i11 + c] * fx;
        d[o + c] = top * (1 - fy) + bottom * fy;
      }
      d[o + 3] = 255;
    }
  }
  ctx.putImageData(outData, 0, 0);
  return out;
};

/** 名前欄などを黒く塗りつぶす（キャンバスを直接書き換える） */
export const blackout = (canvas: HTMLCanvasElement, masks: Rect[]) => {
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#000";
  for (const m of masks) ctx.fillRect(m.x * canvas.width, m.y * canvas.height, m.w * canvas.width, m.h * canvas.height);
};

export type Encoded = { blob: Blob; base64: string };

export const encodeJpeg = async (canvas: HTMLCanvasElement, quality = 0.85): Promise<Encoded> => {
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("画像の変換に失敗しました"))), "image/jpeg", quality),
  );
  return { blob, base64: canvas.toDataURL("image/jpeg", quality).split(",")[1] };
};

/** 解答欄を少し余白をつけて切り出す（ずれても答えが欠けないように） */
export const cropBox = (canvas: HTMLCanvasElement, box: Rect, padding = 0.12) => {
  const padX = box.w * padding;
  const padY = box.h * padding;
  const x = Math.max(0, (box.x - padX) * canvas.width);
  const y = Math.max(0, (box.y - padY) * canvas.height);
  const w = Math.min(canvas.width - x, (box.w + padX * 2) * canvas.width);
  const h = Math.min(canvas.height - y, (box.h + padY * 2) * canvas.height);
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(w));
  out.height = Math.max(1, Math.round(h));
  out.getContext("2d")!.drawImage(canvas, x, y, w, h, 0, 0, out.width, out.height);
  return out;
};

export const blobToCanvas = (blob: Blob) =>
  loadSource(blob).then(({ canvas, url }) => {
    URL.revokeObjectURL(url);
    return canvas;
  });

// ---- 画像をきれいにする・写真の品質チェック ----

const toGray = (data: Uint8ClampedArray) => {
  const g = new Uint8ClampedArray(data.length / 4);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) g[j] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  return g;
};

const percentile = (values: Uint8ClampedArray, p: number) => {
  const hist = new Uint32Array(256);
  for (const v of values) hist[v]++;
  const target = values.length * p;
  let acc = 0;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    if (acc >= target) return i;
  }
  return 255;
};

const MIN_CROP_HEIGHT = 160;

/**
 * 切り出した解答欄を読みやすくする：白黒にして明るさ・コントラストを整え（影やうす暗さを補正）、
 * 小さい字は拡大する。AIの読み間違いを減らすため。
 */
export const enhanceCrop = (crop: HTMLCanvasElement) => {
  const scale = Math.min(3, Math.max(1, MIN_CROP_HEIGHT / crop.height));
  const out = document.createElement("canvas");
  out.width = Math.round(crop.width * scale);
  out.height = Math.round(crop.height * scale);
  const ctx = out.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(crop, 0, 0, out.width, out.height);

  const img = ctx.getImageData(0, 0, out.width, out.height);
  const gray = toGray(img.data);
  // 紙の白さ（明るい方から1割の位置）を真っ白に、それより十分暗い部分を真っ黒にそろえる。
  // 文字が少ない欄でも紙を基準にできるよう、黒の基準は「紙より100以上暗い」位置より明るくしない
  const hi = Math.max(60, percentile(gray, 0.9));
  const lo = Math.max(0, Math.min(percentile(gray, 0.01), hi - 100));
  for (let i = 0, j = 0; i < img.data.length; i += 4, j++) {
    const v = Math.max(0, Math.min(255, ((gray[j] - lo) / (hi - lo)) * 255));
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return out;
};

export type QualityIssue = "blurry" | "dark" | "lowContrast";

export const QUALITY_MESSAGES: Record<QualityIssue, string> = {
  blurry: "ピンぼけしているようです",
  dark: "写真が暗いようです",
  lowContrast: "文字がうすく写っているようです（影や反射）",
};

/** 補正後の答案の写真の品質を調べる（ピンぼけ・暗さ・コントラスト） */
export const assessQuality = (sheet: HTMLCanvasElement): QualityIssue[] => {
  const w = Math.min(800, sheet.width);
  const h = Math.round((sheet.height * w) / sheet.width);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(sheet, 0, 0, w, h);
  const gray = toGray(ctx.getImageData(0, 0, w, h).data);

  // 文字の輪郭のくっきり具合：ラプラシアンの強い部分（上位0.5%）の大きさで見る（文字の量に左右されにくい）
  const lap = new Uint8ClampedArray((w - 2) * (h - 2));
  let k = 0;
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      lap[k++] = Math.abs(4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w]);
    }

  const issues: QualityIssue[] = [];
  if (percentile(lap, 0.995) < 40) issues.push("blurry");
  if (percentile(gray, 0.5) < 100) issues.push("dark");
  if (percentile(gray, 0.95) - percentile(gray, 0.02) < 70) issues.push("lowContrast");
  return issues;
};

// ---- 用紙の四すみの自動検出 ----

/** 明るい部分と暗い部分を分ける境目の明るさ（大津の方法） */
const otsu = (gray: Uint8ClampedArray) => {
  const hist = new Array(256).fill(0);
  for (const v of gray) hist[v]++;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
};

const quadArea = (q: Point[]) =>
  Math.abs(q.reduce((s, p, i) => s + p.x * q[(i + 1) % 4].y - q[(i + 1) % 4].x * p.y, 0)) / 2;

/**
 * 写真の中から白い用紙を見つけて、その四すみを返す。見つからなければ null（指で合わせてもらう）。
 * 机など背景より用紙が明るい写真を想定。
 */
export const detectQuad = (source: HTMLCanvasElement): Quad | null => {
  const scale = Math.min(1, 360 / Math.max(source.width, source.height));
  const w = Math.max(1, Math.round(source.width * scale));
  const h = Math.max(1, Math.round(source.height * scale));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.filter = "blur(2px)"; // 文字をつぶして、用紙をひとかたまりにする
  ctx.drawImage(source, 0, 0, w, h);
  const gray = toGray(ctx.getImageData(0, 0, w, h).data);
  const t = otsu(gray);

  // いちばん大きい「明るいかたまり」を探す
  const label = new Int32Array(w * h).fill(-1);
  let bestId = -1;
  let bestSize = 0;
  const stack: number[] = [];
  for (let start = 0, id = 0; start < w * h; start++) {
    if (gray[start] <= t || label[start] !== -1) continue;
    let size = 0;
    stack.push(start);
    label[start] = id;
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const x = i % w;
      const neighbors = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w];
      for (const n of neighbors)
        if (n >= 0 && n < w * h && label[n] === -1 && gray[n] > t) {
          label[n] = id;
          stack.push(n);
        }
    }
    if (size > bestSize) {
      bestSize = size;
      bestId = id;
    }
    id++;
  }
  if (bestId < 0 || bestSize < w * h * 0.15) return null;

  // かたまりの端の点から四すみを決める（左上=x+yが最小、右下=最大、右上=x−yが最大、左下=最小）
  let tl = { x: 0, y: 0, v: Infinity };
  let br = { x: 0, y: 0, v: -Infinity };
  let tr = { x: 0, y: 0, v: -Infinity };
  let bl = { x: 0, y: 0, v: Infinity };
  for (let i = 0; i < w * h; i++) {
    if (label[i] !== bestId) continue;
    const x = i % w;
    const y = (i - x) / w;
    if (x + y < tl.v) tl = { x, y, v: x + y };
    if (x + y > br.v) br = { x, y, v: x + y };
    if (x - y > tr.v) tr = { x, y, v: x - y };
    if (x - y < bl.v) bl = { x, y, v: x - y };
  }
  const quad = [tl, tr, br, bl].map((p) => ({ x: (p.x + 0.5) / w, y: (p.y + 0.5) / h })) as Quad;
  return quadArea(quad) >= 0.15 ? quad : null;
};
