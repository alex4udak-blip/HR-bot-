import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Mail, Lock, Eye, EyeOff, Sparkles } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/stores/authStore';
import { login } from '@/services/api';
import BackgroundEffects from '@/components/BackgroundEffects';

export default function LoginPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ email: '', password: '' });
  const { setUser } = useAuthStore();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const user = await login(form.email, form.password);
      // Cookie is set by backend, login returns the User directly
      setUser(user);
      toast.success('С возвращением!');
      navigate('/dashboard');
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Ошибка авторизации');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative">
      <BackgroundEffects />

      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="w-full max-w-md relative z-10"
      >
        <div className="glass rounded-2xl p-8 shadow-2xl relative overflow-hidden">
          {/* Decorative gradient orb */}
          <div className="absolute -top-20 -right-20 w-40 h-40 bg-accent-500/20 rounded-full blur-3xl" />
          <div className="absolute -bottom-20 -left-20 w-40 h-40 bg-purple-500/10 rounded-full blur-3xl" />

          <div className="text-center mb-8 relative">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
              className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-accent-500 to-accent-600 mb-4 shadow-lg shadow-accent-500/30"
            >
              <Sparkles className="w-8 h-8 text-white" />
            </motion.div>
            <h1 className="text-3xl font-bold gradient-text mb-2">
              Чат Аналитика
            </h1>
            <p className="text-dark-400">
              Войдите в систему
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="relative group">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-dark-400 group-focus-within:text-accent-400 transition-colors" />
              <input
                type="email"
                placeholder="Email адрес"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                required
                className="w-full input-premium rounded-xl py-3.5 pl-12 pr-4 text-dark-100 placeholder-dark-500 focus:outline-none"
              />
            </div>

            <div className="relative group">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-dark-400 group-focus-within:text-accent-400 transition-colors" />
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="Пароль"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
                className="w-full input-premium rounded-xl py-3.5 pl-12 pr-12 text-dark-100 placeholder-dark-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-dark-400 hover:text-dark-200"
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>

            <motion.button
              whileHover={{ scale: 1.02, boxShadow: "0 10px 40px rgba(12, 165, 235, 0.4)" }}
              whileTap={{ scale: 0.98 }}
              disabled={loading}
              type="submit"
              className="w-full btn-premium text-white font-semibold py-3.5 rounded-xl transition-all duration-300 disabled:opacity-50 relative overflow-hidden"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Загрузка...
                </span>
              ) : (
                'Войти'
              )}
            </motion.button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-dark-500 text-sm">
              Нет аккаунта? Обратитесь к администратору
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
