import { useMemo } from 'react';
import qrcode from 'qrcode-generator';

/**
 * 二维码：纯 SVG，不依赖 canvas，也不联网（局域网对局时手机没有外网）。
 * 库是 qrcode-generator（MIT，体积 ~10KB），自己手写 QR 编码器风险太高。
 */
export function QrCode({ value, size = 132 }: { value: string; size?: number }) {
  const svg = useMemo(() => {
    try {
      const qr = qrcode(0, 'M');
      qr.addData(value);
      qr.make();
      return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    } catch {
      return null;
    }
  }, [value]);

  if (!svg) return null;
  return (
    <div
      className="qr-box"
      style={{ width: size, height: size }}
      // 库生成的是我们自己的 URL 文本，不含外部输入
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
