import { useParams, useNavigate } from 'react-router-dom';
import { Trophy, ArrowLeft } from 'lucide-react';

export default function InternAchievementsPage() {
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
            <Trophy className="w-5 h-5 text-amber-400" />
            <h1 className="text-lg font-bold">Успехи практиканта #{internId}</h1>
          </div>
        </div>
      </div>

      {/* Stub content */}
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center text-white/40">
          <Trophy className="w-16 h-16 mx-auto mb-4 opacity-50 text-amber-400/50" />
          <h3 className="text-lg font-medium mb-2">Выгрузка успехов</h3>
          <p className="text-sm">Раздел в разработке</p>
        </div>
      </div>
    </div>
  );
}
