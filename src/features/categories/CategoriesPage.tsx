import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Plus, Tags, Trash2 } from 'lucide-react';
import * as LucideIcons from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { useCategoryStore } from '../../store/categoryStore';

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.03 } },
};
const item = { hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } };

// Map icon names to Lucide components
function getCategoryIcon(iconName: string | null) {
  if (!iconName) return <Tags size={16} />;
  // Convert kebab-case to PascalCase
  const pascalCase = iconName
    .split('-')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('');
  const iconMap = LucideIcons as unknown as Record<string, LucideIcon>;
  const Icon = iconMap[pascalCase];
  return Icon ? <Icon size={16} /> : <Tags size={16} />;
}

export function CategoriesPage() {
  const { categories, fetchCategories, addCategory, deleteCategory, error } = useCategoryStore();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [formError, setFormError] = useState('');

  useEffect(() => {
    fetchCategories();
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCategoryName.trim()) {
      setFormError('Category name is required');
      return;
    }
    try {
      await addCategory({ name: newCategoryName.trim() });
      setNewCategoryName('');
      setFormError('');
      setIsFormOpen(false);
    } catch (e) {
      setFormError((e as Error).message);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteCategory(id);
    } catch {
      // Error is stored in the store
    }
  };

  const defaultCategories = categories.filter((c) => !c.is_custom);
  const customCategories = categories.filter((c) => c.is_custom);

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="h-full min-h-0 flex flex-col gap-4">
      {/* Header */}
      <motion.div variants={item} className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Categories</h1>
          <p className="text-sm text-text-secondary mt-1">
            Organize your transactions
          </p>
        </div>
        <Button icon={<Plus size={16} />} onClick={() => setIsFormOpen(true)}>
          Add Category
        </Button>
      </motion.div>

      {error && (
        <motion.div variants={item} className="bg-expense-subtle border border-expense/20 text-expense text-sm px-4 py-3 rounded-xl">
          {error}
        </motion.div>
      )}

      <div className="min-h-0 flex-1 overflow-auto pr-1 space-y-6">
        {/* Default Categories */}
        <motion.div variants={item}>
          <h2 className="text-lg font-semibold text-text-primary mb-4">Default Categories</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {defaultCategories.map((cat) => (
              <Card key={cat.id} className="!p-4 flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-accent-subtle flex items-center justify-center text-accent flex-shrink-0">
                  {getCategoryIcon(cat.icon)}
                </div>
                <span className="text-sm font-medium text-text-primary truncate">{cat.name}</span>
              </Card>
            ))}
          </div>
        </motion.div>

        {/* Custom Categories */}
        {customCategories.length > 0 && (
          <motion.div variants={item}>
            <h2 className="text-lg font-semibold text-text-primary mb-4">Custom Categories</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {customCategories.map((cat) => (
                <Card key={cat.id} className="!p-4 group flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-income-subtle flex items-center justify-center text-income flex-shrink-0">
                      {getCategoryIcon(cat.icon)}
                    </div>
                    <span className="text-sm font-medium text-text-primary truncate">{cat.name}</span>
                  </div>
                  <button
                    onClick={() => handleDelete(cat.id)}
                    className="p-1.5 rounded-lg text-text-tertiary hover:text-expense hover:bg-expense-subtle transition-colors opacity-0 group-hover:opacity-100 cursor-pointer"
                    aria-label={`Delete ${cat.name}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </Card>
              ))}
            </div>
          </motion.div>
        )}
      </div>

      {/* Add Category Modal */}
      <Modal isOpen={isFormOpen} onClose={() => setIsFormOpen(false)} title="Add Category" size="sm">
        <form onSubmit={handleAdd} className="space-y-5">
          <Input
            label="Category Name"
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
            placeholder="e.g., Subscriptions"
            autoFocus
            error={formError}
          />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" type="button" onClick={() => setIsFormOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Add Category</Button>
          </div>
        </form>
      </Modal>
    </motion.div>
  );
}
