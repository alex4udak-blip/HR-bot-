import { useState } from 'react'
import { motion } from 'framer-motion'
import { User, Lock, LogOut, Moon, Sun, Bell } from 'lucide-react'
import toast from 'react-hot-toast'
import { Layout, PageHeader } from '../components/layout'
import { Card, Button, Input } from '../components/ui'
import { useAuthStore } from '../lib/store'
import { changePassword } from '../lib/api'

function SettingsSection({ icon: Icon, title, children }) {
  return (
    <Card className="mb-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-dark-800 flex items-center justify-center">
          <Icon className="w-5 h-5 text-accent-400" />
        </div>
        <h3 className="text-lg font-semibold text-dark-100">{title}</h3>
      </div>
      {children}
    </Card>
  )
}

function ToggleSwitch({ checked, onChange, label, description }) {
  return (
    <div className="flex items-center justify-between py-3">
      <div>
        <p className="font-medium text-dark-100">{label}</p>
        {description && (
          <p className="text-sm text-dark-500">{description}</p>
        )}
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
          checked ? 'bg-accent-500' : 'bg-dark-700'
        }`}
      >
        <motion.span
          layout
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
            checked ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  )
}

export function SettingsPage() {
  const { user, logout } = useAuthStore()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [darkMode, setDarkMode] = useState(true)
  const [notifications, setNotifications] = useState(true)

  const handleChangePassword = async () => {
    if (newPassword !== confirmPassword) {
      toast.error('Пароли не совпадают')
      return
    }

    if (newPassword.length < 6) {
      toast.error('Пароль должен быть не менее 6 символов')
      return
    }

    setLoading(true)
    try {
      await changePassword(currentPassword, newPassword)
      toast.success('Пароль успешно изменён')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Ошибка смены пароля')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Layout>
      <PageHeader
        title="Настройки"
        description="Управление аккаунтом и предпочтениями"
      />

      {/* Profile */}
      <SettingsSection icon={User} title="Профиль">
        <div className="grid gap-4 md:grid-cols-2">
          <Input label="Имя" value={user?.name || ''} disabled />
          <Input label="Email" value={user?.email || ''} disabled />
          <Input
            label="Telegram ID"
            value={user?.telegram_id || 'Не привязан'}
            disabled
          />
          <Input
            label="Роль"
            value={user?.role === 'superadmin' ? 'Суперадмин' : 'Админ'}
            disabled
          />
        </div>
      </SettingsSection>

      {/* Security */}
      <SettingsSection icon={Lock} title="Безопасность">
        <div className="space-y-4 max-w-md">
          <Input
            label="Текущий пароль"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="••••••••"
          />
          <Input
            label="Новый пароль"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="••••••••"
          />
          <Input
            label="Подтвердите пароль"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="••••••••"
          />
          <Button onClick={handleChangePassword} loading={loading}>
            Сменить пароль
          </Button>
        </div>
      </SettingsSection>

      {/* Appearance */}
      <SettingsSection icon={Moon} title="Внешний вид">
        <div className="divide-y divide-dark-700">
          <ToggleSwitch
            checked={darkMode}
            onChange={setDarkMode}
            label="Тёмная тема"
            description="Использовать тёмное оформление интерфейса"
          />
          <ToggleSwitch
            checked={notifications}
            onChange={setNotifications}
            label="Уведомления"
            description="Показывать уведомления о новых сообщениях"
          />
        </div>
      </SettingsSection>

      {/* Logout */}
      <Card className="border-red-500/20">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium text-dark-100">Выйти из аккаунта</p>
            <p className="text-sm text-dark-500">
              Вы будете перенаправлены на страницу входа
            </p>
          </div>
          <Button variant="danger" onClick={logout}>
            <LogOut className="w-4 h-4" />
            Выйти
          </Button>
        </div>
      </Card>
    </Layout>
  )
}
