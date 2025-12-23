import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import * as Dialog from '@radix-ui/react-dialog';
import {
  Settings,
  Plus,
  Trash2,
  Target,
  AlertCircle,
  CheckCircle,
  X,
  Save,
  Globe,
  User as UserIcon
} from 'lucide-react';
import {
  getCriteriaPresets,
  createCriteriaPreset,
  deleteCriteriaPreset
} from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import type { Criterion, CriteriaPreset } from '@/types';
import toast from 'react-hot-toast';
import clsx from 'clsx';

const categoryConfig = {
  basic: { icon: Target, color: 'text-blue-400 bg-blue-500/20', label: 'Basic' },
  red_flags: { icon: AlertCircle, color: 'text-red-400 bg-red-500/20', label: 'Red Flags' },
  green_flags: { icon: CheckCircle, color: 'text-green-400 bg-green-500/20', label: 'Green Flags' },
};

export default function SettingsPage() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const { user } = useAuthStore();
  const queryClient = useQueryClient();

  const [newPreset, setNewPreset] = useState({
    name: '',
    description: '',
    category: 'general',
    is_global: false,
    criteria: [] as Criterion[],
  });

  const { data: presets = [], isLoading } = useQuery({
    queryKey: ['criteria-presets'],
    queryFn: getCriteriaPresets,
    refetchOnMount: 'always',
  });

  const createMutation = useMutation({
    mutationFn: () => createCriteriaPreset(newPreset),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['criteria-presets'] });
      setIsDialogOpen(false);
      setNewPreset({
        name: '',
        description: '',
        category: 'general',
        is_global: false,
        criteria: [],
      });
      toast.success('Preset created');
    },
    onError: () => {
      toast.error('Failed to create preset');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteCriteriaPreset,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['criteria-presets'] });
      toast.success('Preset deleted');
    },
  });

  const handleAddCriterion = () => {
    setNewPreset({
      ...newPreset,
      criteria: [
        ...newPreset.criteria,
        { name: '', description: '', weight: 5, category: 'basic' },
      ],
    });
  };

  const handleUpdateCriterion = (index: number, updates: Partial<Criterion>) => {
    setNewPreset({
      ...newPreset,
      criteria: newPreset.criteria.map((c, i) =>
        i === index ? { ...c, ...updates } : c
      ),
    });
  };

  const handleRemoveCriterion = (index: number) => {
    setNewPreset({
      ...newPreset,
      criteria: newPreset.criteria.filter((_, i) => i !== index),
    });
  };

  const groupedPresets = presets.reduce((acc, preset) => {
    const key = preset.is_global ? 'Global' : 'Personal';
    if (!acc[key]) acc[key] = [];
    acc[key].push(preset);
    return acc;
  }, {} as Record<string, CriteriaPreset[]>);

  return (
    <div className="h-full overflow-y-auto p-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-4xl mx-auto space-y-6"
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold mb-2">Settings</h1>
            <p className="text-dark-400">Manage criteria presets and preferences</p>
          </div>
        </div>

        {/* Criteria Presets Section */}
        <div className="glass rounded-2xl p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-semibold">Criteria Presets</h2>
              <p className="text-sm text-dark-400">
                Create reusable evaluation criteria templates
              </p>
            </div>
            <Dialog.Root open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <Dialog.Trigger asChild>
                <button className="flex items-center gap-2 px-4 py-2 rounded-xl bg-accent-500 text-white hover:bg-accent-600 transition-colors">
                  <Plus className="w-5 h-5" />
                  New Preset
                </button>
              </Dialog.Trigger>
              <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-sm" />
                <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-2xl max-h-[90vh] glass rounded-2xl p-6 shadow-xl overflow-y-auto">
                  <Dialog.Title className="text-xl font-semibold mb-4">
                    Create Criteria Preset
                  </Dialog.Title>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      createMutation.mutate();
                    }}
                    className="space-y-4"
                  >
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm text-dark-400 mb-1">Name</label>
                        <input
                          type="text"
                          value={newPreset.name}
                          onChange={(e) => setNewPreset({ ...newPreset, name: e.target.value })}
                          required
                          className="w-full glass-light rounded-xl py-2.5 px-4 focus:outline-none focus:ring-2 focus:ring-accent-500/50"
                        />
                      </div>
                      <div>
                        <label className="block text-sm text-dark-400 mb-1">Category</label>
                        <input
                          type="text"
                          value={newPreset.category}
                          onChange={(e) => setNewPreset({ ...newPreset, category: e.target.value })}
                          className="w-full glass-light rounded-xl py-2.5 px-4 focus:outline-none focus:ring-2 focus:ring-accent-500/50"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm text-dark-400 mb-1">Description</label>
                      <textarea
                        value={newPreset.description}
                        onChange={(e) => setNewPreset({ ...newPreset, description: e.target.value })}
                        rows={2}
                        className="w-full glass-light rounded-xl py-2.5 px-4 focus:outline-none focus:ring-2 focus:ring-accent-500/50 resize-none"
                      />
                    </div>

                    {user?.role === 'superadmin' && (
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={newPreset.is_global}
                          onChange={(e) => setNewPreset({ ...newPreset, is_global: e.target.checked })}
                          className="w-4 h-4 rounded accent-accent-500"
                        />
                        <span className="text-sm">Make this preset available to all users</span>
                      </label>
                    )}

                    {/* Criteria */}
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <label className="text-sm text-dark-400">Criteria</label>
                        <button
                          type="button"
                          onClick={handleAddCriterion}
                          className="flex items-center gap-1 text-xs text-accent-400 hover:text-accent-300"
                        >
                          <Plus className="w-3 h-3" />
                          Add
                        </button>
                      </div>
                      <div className="space-y-3 max-h-64 overflow-y-auto">
                        {newPreset.criteria.map((criterion, index) => (
                          <div key={index} className="glass-light rounded-xl p-3 space-y-2">
                            <div className="flex gap-2">
                              <input
                                type="text"
                                value={criterion.name}
                                onChange={(e) => handleUpdateCriterion(index, { name: e.target.value })}
                                placeholder="Criterion name"
                                className="flex-1 bg-transparent border-b border-white/10 pb-1 text-sm focus:outline-none focus:border-accent-500"
                              />
                              <button
                                type="button"
                                onClick={() => handleRemoveCriterion(index)}
                                className="text-dark-500 hover:text-red-400"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                            <textarea
                              value={criterion.description}
                              onChange={(e) => handleUpdateCriterion(index, { description: e.target.value })}
                              placeholder="Description"
                              rows={1}
                              className="w-full bg-transparent text-xs text-dark-400 resize-none focus:outline-none"
                            />
                            <div className="flex gap-4">
                              <select
                                value={criterion.category}
                                onChange={(e) => handleUpdateCriterion(index, { category: e.target.value as Criterion['category'] })}
                                className="bg-dark-800 rounded-lg px-2 py-1 text-xs focus:outline-none"
                              >
                                <option value="basic">Basic</option>
                                <option value="red_flags">Red Flags</option>
                                <option value="green_flags">Green Flags</option>
                              </select>
                              <div className="flex items-center gap-1">
                                <span className="text-xs text-dark-500">Weight:</span>
                                <input
                                  type="number"
                                  min="1"
                                  max="10"
                                  value={criterion.weight}
                                  onChange={(e) => handleUpdateCriterion(index, { weight: parseInt(e.target.value) })}
                                  className="w-12 bg-dark-800 rounded-lg px-2 py-1 text-xs focus:outline-none"
                                />
                              </div>
                            </div>
                          </div>
                        ))}
                        {newPreset.criteria.length === 0 && (
                          <p className="text-center text-dark-500 text-sm py-4">
                            No criteria added yet
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex gap-3 pt-4">
                      <Dialog.Close asChild>
                        <button
                          type="button"
                          className="flex-1 py-2.5 rounded-xl glass-light hover:bg-white/10 transition-colors"
                        >
                          Cancel
                        </button>
                      </Dialog.Close>
                      <button
                        type="submit"
                        disabled={createMutation.isPending || newPreset.criteria.length === 0}
                        className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-accent-500 text-white hover:bg-accent-600 disabled:opacity-50 transition-colors"
                      >
                        <Save className="w-4 h-4" />
                        {createMutation.isPending ? 'Creating...' : 'Create'}
                      </button>
                    </div>
                  </form>
                  <Dialog.Close asChild>
                    <button className="absolute top-4 right-4 p-2 rounded-lg hover:bg-white/5">
                      <X className="w-5 h-5" />
                    </button>
                  </Dialog.Close>
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-6 h-6 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : presets.length === 0 ? (
            <div className="text-center py-8">
              <Settings className="w-12 h-12 mx-auto text-dark-600 mb-3" />
              <p className="text-dark-400">No presets yet</p>
              <p className="text-dark-500 text-sm mt-1">
                Create your first criteria preset
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {Object.entries(groupedPresets).map(([group, items]) => (
                <div key={group}>
                  <div className="flex items-center gap-2 mb-3">
                    {group === 'Global' ? (
                      <Globe className="w-4 h-4 text-purple-400" />
                    ) : (
                      <UserIcon className="w-4 h-4 text-blue-400" />
                    )}
                    <h3 className="text-sm font-medium text-dark-400">{group} Presets</h3>
                  </div>
                  <div className="space-y-2">
                    {items.map((preset) => (
                      <motion.div
                        key={preset.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="flex items-start gap-4 glass-light rounded-xl p-4"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h4 className="font-medium">{preset.name}</h4>
                            <span className="px-2 py-0.5 rounded-full text-xs bg-dark-700 text-dark-400">
                              {preset.criteria.length} criteria
                            </span>
                          </div>
                          {preset.description && (
                            <p className="text-sm text-dark-400 mb-2">{preset.description}</p>
                          )}
                          <div className="flex flex-wrap gap-1">
                            {preset.criteria.slice(0, 3).map((c, i) => {
                              const config = categoryConfig[c.category as keyof typeof categoryConfig];
                              return (
                                <span
                                  key={i}
                                  className={clsx('px-2 py-0.5 rounded-full text-xs', config?.color)}
                                >
                                  {c.name}
                                </span>
                              );
                            })}
                            {preset.criteria.length > 3 && (
                              <span className="text-xs text-dark-500">
                                +{preset.criteria.length - 3} more
                              </span>
                            )}
                          </div>
                        </div>
                        {(preset.created_by === user?.id || user?.role === 'superadmin') && (
                          <button
                            onClick={() => {
                              if (confirm('Delete this preset?')) {
                                deleteMutation.mutate(preset.id);
                              }
                            }}
                            className="p-2 rounded-lg text-dark-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </motion.div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Account Info */}
        <div className="glass rounded-2xl p-6">
          <h2 className="text-lg font-semibold mb-4">Account</h2>
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-accent-500/20 to-purple-500/20 flex items-center justify-center">
                <span className="text-2xl font-bold text-accent-400">
                  {user?.name?.[0]?.toUpperCase() || 'U'}
                </span>
              </div>
              <div>
                <h3 className="font-semibold text-lg">{user?.name}</h3>
                <p className="text-dark-400">{user?.email}</p>
                <span
                  className={clsx(
                    'inline-block mt-1 px-2 py-0.5 rounded-full text-xs font-medium',
                    user?.role === 'superadmin'
                      ? 'bg-purple-500/20 text-purple-400'
                      : 'bg-blue-500/20 text-blue-400'
                  )}
                >
                  {user?.role}
                </span>
              </div>
            </div>
            {user?.telegram_username && (
              <div className="glass-light rounded-xl p-4">
                <p className="text-sm text-dark-400 mb-1">Telegram Account</p>
                <p className="font-medium">@{user.telegram_username}</p>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
