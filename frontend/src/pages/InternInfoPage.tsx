import { useParams, useNavigate } from 'react-router-dom';
import { Info, ArrowLeft } from 'lucide-react';

export default function InternInfoPage() {
  const { internId } = useParams<{ internId: string }>();
  const navigate = useNavigate();

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/interns')}
            className="p-2 hover:bg-white/5 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-white/60" />
          </button>
          <div className="flex items-center gap-2">
            <Info className="w-5 h-5 text-blue-400" />
            <h1 className="text-lg font-bold">Информация о практиканте #{internId}</h1>
          </div>
        </div>
      </div>

      {/* Stub content */}
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center text-white/40">
          <Info className="w-16 h-16 mx-auto mb-4 opacity-50 text-blue-400/50" />
          <h3 className="text-lg font-medium mb-2">Выгрузка информации</h3>
          <p className="text-sm">Раздел в разработке</p>
        </div>
      </div>
    </div>
  );
}
