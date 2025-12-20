import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  UserPlus,
  MoreVertical,
  Edit,
  Trash2,
  Shield,
  ShieldCheck,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { Layout, PageHeader } from '../components/layout'
import {
  Card,
  Button,
  Avatar,
  Badge,
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Input,
  EmptyState,
  SkeletonTable,
} from '../components/ui'
import { getUsers, createUser, updateUser, deleteUser } from '../lib/api'
import { formatDate } from '../lib/utils'

function UserModal({ open, onClose, user, onSave }) {
  const [formData, setFormData] = useState({
    email: user?.email || '',
    name: user?.name || '',
    password: '',
    role: user?.role || 'admin',
    telegram_id: user?.telegram_id || '',
  })
  const [loading, setLoading] = useState(false)

  const handleSubmit = async () => {
    setLoading(true)
    try {
      await onSave(formData)
      onClose()
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} className="max-w-lg">
      <ModalHeader onClose={onClose}>
        {user ? 'Редактировать пользователя' : 'Новый пользователь'}
      </ModalHeader>
      <ModalBody>
        <Input
          label="Имя"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder="Иван Иванов"
        />
        <Input
          label="Email"
          type="email"
          value={formData.email}
          onChange={(e) => setFormData({ ...formData, email: e.target.value })}
          placeholder="ivan@example.com"
        />
        {!user && (
          <Input
            label="Пароль"
            type="password"
            value={formData.password}
            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
            placeholder="••••••••"
          />
        )}
        <Input
          label="Telegram ID"
          value={formData.telegram_id}
          onChange={(e) => setFormData({ ...formData, telegram_id: e.target.value })}
          placeholder="123456789"
        />
        <div>
          <label className="label">Роль</label>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setFormData({ ...formData, role: 'admin' })}
              className={`flex-1 p-3 rounded-xl border transition-all ${
                formData.role === 'admin'
                  ? 'border-accent-500 bg-accent-500/10'
                  : 'border-dark-700 hover:border-dark-600'
              }`}
            >
              <Shield className="w-5 h-5 mx-auto mb-2 text-dark-300" />
              <p className="text-sm font-medium text-dark-100">Админ</p>
              <p className="text-xs text-dark-500">Доступ к своим чатам</p>
            </button>
            <button
              type="button"
              onClick={() => setFormData({ ...formData, role: 'superadmin' })}
              className={`flex-1 p-3 rounded-xl border transition-all ${
                formData.role === 'superadmin'
                  ? 'border-purple-500 bg-purple-500/10'
                  : 'border-dark-700 hover:border-dark-600'
              }`}
            >
              <ShieldCheck className="w-5 h-5 mx-auto mb-2 text-purple-400" />
              <p className="text-sm font-medium text-dark-100">Суперадмин</p>
              <p className="text-xs text-dark-500">Полный доступ</p>
            </button>
          </div>
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>
          Отмена
        </Button>
        <Button onClick={handleSubmit} loading={loading}>
          {user ? 'Сохранить' : 'Создать'}
        </Button>
      </ModalFooter>
    </Modal>
  )
}

function DeleteModal({ open, onClose, user, onConfirm }) {
  const [loading, setLoading] = useState(false)

  const handleDelete = async () => {
    setLoading(true)
    try {
      await onConfirm()
      onClose()
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose}>
      <ModalHeader onClose={onClose}>Удалить пользователя?</ModalHeader>
      <ModalBody>
        <p className="text-dark-300">
          Вы уверены, что хотите удалить пользователя{' '}
          <span className="font-medium text-dark-100">{user?.name}</span>?
          Это действие нельзя отменить.
        </p>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>
          Отмена
        </Button>
        <Button variant="danger" onClick={handleDelete} loading={loading}>
          Удалить
        </Button>
      </ModalFooter>
    </Modal>
  )
}

export function UsersPage() {
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [editUser, setEditUser] = useState(null)
  const [deleteModalUser, setDeleteModalUser] = useState(null)

  const queryClient = useQueryClient()

  const { data: users, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: getUsers,
  })

  const createMutation = useMutation({
    mutationFn: createUser,
    onSuccess: () => {
      queryClient.invalidateQueries(['users'])
      toast.success('Пользователь создан')
    },
    onError: (error) => {
      toast.error(error.response?.data?.detail || 'Ошибка создания')
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => updateUser(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['users'])
      toast.success('Пользователь обновлён')
    },
    onError: (error) => {
      toast.error(error.response?.data?.detail || 'Ошибка обновления')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: deleteUser,
    onSuccess: () => {
      queryClient.invalidateQueries(['users'])
      toast.success('Пользователь удалён')
    },
    onError: (error) => {
      toast.error(error.response?.data?.detail || 'Ошибка удаления')
    },
  })

  return (
    <Layout>
      <PageHeader
        title="Пользователи"
        description="Управление администраторами системы"
        actions={
          <Button onClick={() => setCreateModalOpen(true)}>
            <UserPlus className="w-4 h-4" />
            Добавить
          </Button>
        }
      />

      {isLoading ? (
        <SkeletonTable rows={5} />
      ) : users?.length === 0 ? (
        <EmptyState
          icon={UserPlus}
          title="Нет пользователей"
          description="Добавьте первого администратора"
          action={
            <Button onClick={() => setCreateModalOpen(true)}>
              <UserPlus className="w-4 h-4" />
              Добавить пользователя
            </Button>
          }
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-dark-700">
                  <th className="text-left p-4 text-dark-400 font-medium">
                    Пользователь
                  </th>
                  <th className="text-left p-4 text-dark-400 font-medium">
                    Роль
                  </th>
                  <th className="text-left p-4 text-dark-400 font-medium">
                    Telegram
                  </th>
                  <th className="text-left p-4 text-dark-400 font-medium">
                    Чаты
                  </th>
                  <th className="text-left p-4 text-dark-400 font-medium">
                    Создан
                  </th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody>
                {users?.map((user, index) => (
                  <motion.tr
                    key={user.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                    className="border-b border-dark-800 hover:bg-dark-800/50 transition-colors"
                  >
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <Avatar name={user.name} />
                        <div>
                          <p className="font-medium text-dark-100">
                            {user.name}
                          </p>
                          <p className="text-sm text-dark-500">{user.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="p-4">
                      <Badge
                        variant={
                          user.role === 'superadmin' ? 'warning' : 'info'
                        }
                      >
                        {user.role === 'superadmin' ? 'Суперадмин' : 'Админ'}
                      </Badge>
                    </td>
                    <td className="p-4 text-dark-400">
                      {user.telegram_id || '—'}
                    </td>
                    <td className="p-4 text-dark-400">{user.chats_count}</td>
                    <td className="p-4 text-dark-500 text-sm">
                      {formatDate(user.created_at)}
                    </td>
                    <td className="p-4">
                      <div className="flex gap-1">
                        <button
                          onClick={() => setEditUser(user)}
                          className="p-2 rounded-lg hover:bg-dark-700 transition-colors"
                        >
                          <Edit className="w-4 h-4 text-dark-400" />
                        </button>
                        <button
                          onClick={() => setDeleteModalUser(user)}
                          className="p-2 rounded-lg hover:bg-dark-700 transition-colors"
                        >
                          <Trash2 className="w-4 h-4 text-red-400" />
                        </button>
                      </div>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Create Modal */}
      <UserModal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onSave={(data) => createMutation.mutateAsync(data)}
      />

      {/* Edit Modal */}
      <UserModal
        open={!!editUser}
        onClose={() => setEditUser(null)}
        user={editUser}
        onSave={(data) =>
          updateMutation.mutateAsync({ id: editUser.id, data })
        }
      />

      {/* Delete Modal */}
      <DeleteModal
        open={!!deleteModalUser}
        onClose={() => setDeleteModalUser(null)}
        user={deleteModalUser}
        onConfirm={() => deleteMutation.mutateAsync(deleteModalUser?.id)}
      />
    </Layout>
  )
}
