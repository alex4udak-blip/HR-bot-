import { useRef, useState, MouseEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getDocument, signDocument } from '../api/documents';
import { FxSpinner, FxPill } from './ui';

export default function SignDocumentModal({ docId, onClose }: { docId: number; onClose: () => void }) {
  const qc = useQueryClient();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(false);
  const [err, setErr] = useState('');

  const { data: doc, isLoading } = useQuery({ queryKey: ['fx', 'doc', docId], queryFn: () => getDocument(docId) });

  const sign = useMutation({
    mutationFn: () => signDocument(docId, canvasRef.current!.toDataURL('image/png')),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['fx'] }); onClose(); },
    onError: () => setErr('Не удалось сохранить подпись.'),
  });

  const at = (e: MouseEvent) => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height };
  };
  const down = (e: MouseEvent) => { drawing.current = true; const ctx = canvasRef.current!.getContext('2d')!; const p = at(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); };
  const move = (e: MouseEvent) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current!.getContext('2d')!;
    const p = at(e);
    ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.strokeStyle = '#0F172A';
    ctx.lineTo(p.x, p.y); ctx.stroke();
    setHasInk(true);
  };
  const up = () => { drawing.current = false; };
  const clear = () => { const c = canvasRef.current!; c.getContext('2d')!.clearRect(0, 0, c.width, c.height); setHasInk(false); };

  return (
    <div className="fx-modal-overlay" onClick={onClose}>
      <div className="fx-modal" style={{ width: 600, maxHeight: '90vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        {isLoading || !doc ? <FxSpinner /> : (
          <>
            <h3>{doc.title} {doc.status === 'signed' && <FxPill tone="green" dot>Подписан</FxPill>}</h3>
            <div style={{ whiteSpace: 'pre-wrap', background: '#F8FAFC', border: '1px solid #E5E7EB', borderRadius: 10, padding: 16, fontSize: 13, maxHeight: 240, overflowY: 'auto' }}>
              {doc.content_rendered}
            </div>
            {doc.status === 'signed' ? (
              <div style={{ marginTop: 16 }}>
                <div className="fx-sub">Подпись:</div>
                {doc.signature_data && <img src={doc.signature_data} alt="Подпись" style={{ maxHeight: 120, border: '1px solid #E5E7EB', borderRadius: 8, marginTop: 6 }} />}
              </div>
            ) : (
              <>
                <div className="fx-sub" style={{ marginTop: 16, marginBottom: 6 }}>Распишитесь в поле ниже:</div>
                <canvas ref={canvasRef} width={540} height={150}
                  style={{ border: '1px dashed #CBD5E1', borderRadius: 8, background: '#fff', width: '100%', height: 150, touchAction: 'none', cursor: 'crosshair' }}
                  onMouseDown={down} onMouseMove={move} onMouseUp={up} onMouseLeave={up} />
              </>
            )}
            {err && <div style={{ color: '#B91C1C', fontSize: 13, marginTop: 8 }}>{err}</div>}
            <div className="fx-modal-actions">
              {doc.status !== 'signed' && <button className="fx-btn fx-btn--ghost" onClick={clear}>Очистить</button>}
              <button className="fx-btn fx-btn--secondary" onClick={onClose}>Закрыть</button>
              {doc.status !== 'signed' && (
                <button className="fx-btn fx-btn--primary" disabled={!hasInk || sign.isPending} onClick={() => sign.mutate()}>
                  {sign.isPending ? 'Подписание…' : 'Подписать'}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
