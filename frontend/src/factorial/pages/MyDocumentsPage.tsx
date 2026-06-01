import { useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { ColumnDef } from '@tanstack/react-table';
import { useQuery } from '@tanstack/react-query';
import TableTemplate from '@/factorial/templates/TableTemplate';
import SignDocumentModal from '@/factorial/components/SignDocumentModal';
import { myDocuments } from '@/factorial/api/documents';
import type { SignedDoc } from '@/factorial/api/types';
import { formatDateRu } from '@/factorial/lib/formatDate';
import { CABINET_TABS } from '@/factorial/lib/routes';

interface DocRow {
  id: number;
  name: string;
  folder: string;
  status: string; // signed | pending
  statusLabel: string;
  date: string;
}

export default function MyDocumentsPage() {
  // Реальные документы текущего пользователя из бэкенда Энцеладуса.
  const { data: docs = [] } = useQuery({ queryKey: ['fx', 'my-docs'], queryFn: myDocuments });
  const [signId, setSignId] = useState<number | null>(null);

  const rows: DocRow[] = docs.map((d: SignedDoc) => ({
    id: d.id,
    name: d.title,
    folder: 'Документы',
    status: d.status,
    statusLabel: d.status === 'signed' ? 'Подписан' : 'На подпись',
    date: d.signed_at || d.created_at || '',
  }));

  const columns: ColumnDef<DocRow, any>[] = [
    { accessorKey: 'name', header: 'Имя' },
    { accessorKey: 'folder', header: 'Папка' },
    {
      accessorKey: 'statusLabel',
      header: 'Статус',
      cell: ({ row }) => (
        <span className={row.original.status === 'signed' ? 'text-emerald-600' : 'text-amber-600'}>
          {row.original.statusLabel}
        </span>
      ),
    },
    { accessorKey: 'date', header: 'Дата', cell: ({ getValue }) => { const v = getValue() as string; return v ? formatDateRu(v) : '—'; } },
    {
      id: 'action',
      header: '',
      cell: ({ row }) => (
        <button
          type="button"
          onClick={() => setSignId(row.original.id)}
          className="px-3 py-1.5 rounded-fx-lg text-fx-sm font-medium border border-border bg-white hover:bg-sidebar-hover"
        >
          {row.original.status === 'signed' ? 'Открыть' : 'Подписать'}
        </button>
      ),
      size: 120,
    },
  ];

  return (
    <>
      <TableTemplate
        breadcrumb={[{ label: 'Соглашения' }]}
        titleIcon={
          <div className="w-9 h-9 rounded-fx-lg bg-amber-100 flex items-center justify-center">
            <FolderOpen className="w-5 h-5 text-amber-600" />
          </div>
        }
        title="Соглашения"
        secondaryNav={CABINET_TABS}
        toolbar={{ searchKey: 'name', searchPlaceholder: 'Поиск документа...' }}
        columns={columns}
        data={rows}
        emptyState={{ emoji: '📄', heading: 'Документов пока нет', description: 'Здесь появятся документы, отправленные вам на подпись.' }}
      />
      {signId != null && <SignDocumentModal docId={signId} onClose={() => setSignId(null)} />}
    </>
  );
}
