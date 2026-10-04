import { useEffect, useRef, useState } from "react";

const INKS = ["#222222", "#e4572e", "#4c6ef5", "#29bf12", "#9c36b5", "#f3a712"];
const W = 800;
const H = 560;

/** A small drawing pad for doodles and kid art. Works with fingers and pens. */
export function DoodlePad({ onDone, onCancel }: { onDone: (png: Blob) => void; onCancel: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ink, setInk] = useState(INKS[0]);
  const [size, setSize] = useState(8);
  const [dirty, setDirty] = useState(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const ctx = canvas.current!.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);
  }, []);

  function point(e: React.PointerEvent) {
    const r = canvas.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  }

  function draw(from: { x: number; y: number }, to: { x: number; y: number }, pressure: number) {
    const ctx = canvas.current!.getContext("2d")!;
    ctx.strokeStyle = ink;
    ctx.lineWidth = size * (pressure > 0 && pressure !== 0.5 ? 0.5 + pressure : 1);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }

  return (
    <div className="doodle">
      <canvas
        ref={canvas}
        width={W}
        height={H}
        className="doodle-canvas"
        aria-label="Drawing area"
        onPointerDown={(e) => {
          (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
          last.current = point(e);
          draw(last.current, last.current, e.pressure);
          setDirty(true);
        }}
        onPointerMove={(e) => {
          if (!last.current) return;
          const p = point(e);
          draw(last.current, p, e.pressure);
          last.current = p;
        }}
        onPointerUp={() => (last.current = null)}
        onPointerCancel={() => (last.current = null)}
      />
      <div className="row wrap between">
        <div className="swatches" role="radiogroup" aria-label="Ink">
          {INKS.map((c) => (
            <button
              key={c}
              role="radio"
              aria-checked={ink === c}
              aria-label={c}
              className={`swatch round${ink === c ? " on" : ""}`}
              style={{ background: c }}
              onClick={() => setInk(c)}
            />
          ))}
          <button
            role="radio"
            aria-checked={ink === "#ffffff"}
            className={`swatch round eraser${ink === "#ffffff" ? " on" : ""}`}
            aria-label="Eraser"
            onClick={() => setInk("#ffffff")}
          >
            🧽
          </button>
        </div>
        <div className="row">
          {[4, 8, 16].map((s) => (
            <button
              key={s}
              className={`chip${size === s ? " on" : ""}`}
              onClick={() => setSize(s)}
              aria-label={`Brush ${s}`}
            >
              <span className="dot" style={{ width: s + 2, height: s + 2 }} />
            </button>
          ))}
        </div>
      </div>
      <div className="row between">
        <button
          className="btn ghost"
          onClick={() => {
            const ctx = canvas.current!.getContext("2d")!;
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, W, H);
            setDirty(false);
          }}
        >
          Clear
        </button>
        <div className="row">
          <button className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={!dirty}
            onClick={() => canvas.current!.toBlob((b) => b && onDone(b), "image/png")}
          >
            Use drawing
          </button>
        </div>
      </div>
    </div>
  );
}
