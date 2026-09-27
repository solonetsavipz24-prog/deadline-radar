export type TaskStatus = 'todo' | 'progress' | 'done'
export type TaskPriority = 'low' | 'medium' | 'high'
export type RepeatRule = 'none' | 'daily' | 'weekly' | 'monthly'

export type Task = {
  id: string
  title: string
  subject: string
  due: string
  description: string
  link: string
  status: TaskStatus
  priority: TaskPriority
  repeat: RepeatRule
  repeatDay: number | null
  remind: boolean
}

export type TaskDraft = Omit<Task, 'id'>

export const STORAGE_KEY = 'deadline-radar-tasks'

export const starterTasks: Task[] = [
  { id: 'starter-1', title: 'Підготувати презентацію проєкту', subject: 'UX/UI дизайн', due: '2026-10-02T18:00', description: 'Фінальні слайди та прототип для захисту.', link: '', status: 'progress', priority: 'high', repeat: 'none', repeatDay: null, remind: true },
  { id: 'starter-2', title: 'Прочитати розділ 4–6', subject: 'Культурологія', due: '2026-10-05T10:00', description: 'Занотувати ключові тези до семінару.', link: '', status: 'todo', priority: 'medium', repeat: 'none', repeatDay: null, remind: false },
  { id: 'starter-3', title: 'Здати лабораторну роботу №2', subject: 'Програмування', due: '2026-10-08T23:59', description: 'Перевірити тести та завантажити репозиторій.', link: 'https://github.com/', status: 'todo', priority: 'high', repeat: 'none', repeatDay: null, remind: true },
]

const statuses = new Set<TaskStatus>(['todo', 'progress', 'done'])
const priorities = new Set<TaskPriority>(['low', 'medium', 'high'])
const repeats = new Set<RepeatRule>(['none', 'daily', 'weekly', 'monthly'])

export function isSafeTaskLink(value: string) {
  if (!value) return true
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function isTask(value: unknown): value is Task {
  if (!value || typeof value !== 'object') return false
  const task = value as Record<string, unknown>
  return typeof task.id === 'string' &&
    typeof task.title === 'string' && task.title.trim().length > 0 &&
    typeof task.subject === 'string' && task.subject.trim().length > 0 &&
    typeof task.due === 'string' && !Number.isNaN(Date.parse(task.due)) &&
    typeof task.description === 'string' && typeof task.link === 'string' && isSafeTaskLink(task.link) &&
    statuses.has(task.status as TaskStatus) &&
    priorities.has(task.priority as TaskPriority) &&
    repeats.has(task.repeat as RepeatRule) &&
    (task.repeatDay === null || (typeof task.repeatDay === 'number' && task.repeatDay >= 1 && task.repeatDay <= 31)) &&
    typeof task.remind === 'boolean'
}

function upgradeTask(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value
  const task = value as Record<string, unknown>
  const repeat = task.repeat ?? 'none'
  const due = typeof task.due === 'string' ? new Date(task.due) : null
  return {
    ...task,
    description: typeof task.description === 'string' ? task.description : '',
    link: typeof task.link === 'string' ? task.link : '',
    priority: task.priority ?? 'medium',
    repeat,
    repeatDay: task.repeatDay ?? (repeat === 'monthly' && due && !Number.isNaN(due.getTime()) ? due.getDate() : null),
    remind: task.remind ?? false,
  }
}

export function parseTaskBackup(json: string): Task[] {
  const parsed: unknown = JSON.parse(json)
  const entries = Array.isArray(parsed) ? parsed : (parsed as { tasks?: unknown })?.tasks
  if (!Array.isArray(entries)) {
    throw new Error('Файл резервної копії має невірний формат або містить некоректні завдання.')
  }
  const upgraded = entries.map(upgradeTask)
  if (!upgraded.every(isTask)) throw new Error('Файл резервної копії має невірний формат або містить некоректні завдання.')
  return upgraded
}

export function groupTasks(tasks: Task[], now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)
  const endOfWeek = new Date(today)
  endOfWeek.setDate(today.getDate() + ((8 - today.getDay()) % 7 || 7))
  const groups: Record<'overdue' | 'today' | 'week' | 'later', Task[]> = {
    overdue: [], today: [], week: [], later: [],
  }
  for (const task of tasks) {
    const due = new Date(task.due)
    if (due < today && task.status !== 'done') groups.overdue.push(task)
    else if (due < today) groups.later.push(task)
    else if (due < tomorrow) groups.today.push(task)
    else if (due < endOfWeek) groups.week.push(task)
    else groups.later.push(task)
  }
  return groups
}

export function nextOccurrence(dueValue: string, repeat: RepeatRule, repeatDay?: number | null): string | null {
  if (repeat === 'none') return null
  const due = new Date(dueValue)
  if (repeat === 'daily') due.setDate(due.getDate() + 1)
  if (repeat === 'weekly') due.setDate(due.getDate() + 7)
  if (repeat === 'monthly') {
    const day = repeatDay ?? due.getDate()
    due.setDate(1)
    due.setMonth(due.getMonth() + 1)
    const lastDay = new Date(due.getFullYear(), due.getMonth() + 1, 0).getDate()
    due.setDate(Math.min(day, lastDay))
  }
  return due.toISOString()
}

export function sortTasks(tasks: Task[], sort: 'due' | 'priority' | 'newest'): Task[] {
  const priorityRank: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 }
  return [...tasks].sort((a, b) => {
    if (sort === 'priority') return priorityRank[a.priority] - priorityRank[b.priority] || Date.parse(a.due) - Date.parse(b.due)
    if (sort === 'newest') return Date.parse(b.due) - Date.parse(a.due)
    return Date.parse(a.due) - Date.parse(b.due)
  })
}

export function mapDatabaseTask(row: Record<string, unknown>): Task {
  return {
    id: String(row.id),
    title: String(row.title),
    subject: String(row.subject),
    due: String(row.due_at),
    description: String(row.description ?? ''),
    link: String(row.link ?? ''),
    status: row.status as TaskStatus,
    priority: row.priority as TaskPriority,
    repeat: row.repeat_rule as RepeatRule,
    repeatDay: row.repeat_day === null || row.repeat_day === undefined ? null : Number(row.repeat_day),
    remind: Boolean(row.remind),
  }
}

export function toDatabaseTask(task: TaskDraft) {
  return {
    title: task.title,
    subject: task.subject,
    due_at: new Date(task.due).toISOString(),
    description: task.description,
    link: task.link,
    status: task.status,
    priority: task.priority,
    repeat_rule: task.repeat,
    repeat_day: task.repeatDay,
    remind: task.remind,
  }
}
